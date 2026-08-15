import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';

import {
  candidateDocumentListResponseSchema,
  candidateListResponseSchema,
  candidateSchema,
  complianceDocumentSchema,
  cvExtractionSchema,
  healthResponseSchema,
  loginResponseSchema,
  tenantContextSchema,
  userIdentitySchema,
  verificationRequestSchema,
} from '@candidate-compliance/contracts';
import { PrismaClient } from '@prisma/client';

import {
  DEVELOPMENT_DEMO_PASSWORD,
  SEED_IDS,
  USERS,
  seedDevelopmentData,
} from '../../../prisma/seed.js';
import { createApp } from '../src/app.js';
import { readJwtConfig } from '../src/config/jwt-config.js';
import { loadEnvironment } from '../src/config/load-environment.js';
import { withTenantTransaction } from '../src/infrastructure/database/with-tenant-transaction.js';
import { AUDIT_ACTIONS } from '../src/modules/audit/audit.service.js';
import { DeterministicLocalRightToWorkVerifier } from '../src/modules/verification/right-to-work-verifier.js';
import { processNextVerificationEvent } from '../src/modules/verification/verification.processor.js';

const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const PROHIBITED_ENVIRONMENTS = new Set([
  'prod',
  'production',
  'stage',
  'staging',
]);
const ENVIRONMENT_MODE_KEYS = [
  'NODE_ENV',
  'APP_ENV',
  'ENVIRONMENT',
  'DEPLOYMENT_ENV',
] as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const STEP_NAMES = [
  'Database safety',
  'Database readiness',
  'API readiness',
  'Authentication',
  'Tenant contexts',
  'Candidate creation',
  'Candidate replay',
  'Candidate read/list',
  'Tenant isolation',
  'Document creation',
  'Document approval/replay',
  'Semantic re-approval',
  'Expiry endpoint',
  'Verification submission',
  'Verification worker',
  'Verification read',
  'CV proposal',
  'CV pre-confirmation',
  'CV retrieval',
  'CV confirmation',
  'Document removal/replay',
  'Removed document denial',
  'Candidate removal/replay',
  'Removed candidate denial',
  'Audit evidence',
  'Retained history',
  'Runtime protections',
] as const;

type StepName = (typeof STEP_NAMES)[number];
type WriteLine = (line: string) => void;
type Cleanup = () => void | Promise<void>;

interface DatabaseTarget {
  host: string;
  port: string;
  database: string;
}

export interface DatabaseSafetyResult {
  runtime: DatabaseTarget;
  administrative: DatabaseTarget;
}

interface StepResult {
  name: StepName;
  outcome: 'PASS' | 'FAIL' | 'SKIP';
  elapsedMs: number;
}

interface ApiResult {
  status: number;
  body: unknown;
  rawBody: string;
}

class SmokeFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmokeFailure';
  }
}

class SmokeReporter {
  private readonly results: StepResult[] = [];
  private readonly startedAt = performance.now();

  constructor(private readonly write: WriteLine) {}

  async step<T>(name: StepName, action: () => Promise<T>): Promise<T> {
    const expectedName = STEP_NAMES[this.results.length];

    ensure(expectedName === name, `Smoke step order expected ${expectedName}.`);
    const startedAt = performance.now();

    try {
      const result = await action();
      const elapsedMs = performance.now() - startedAt;
      this.results.push({ name, outcome: 'PASS', elapsedMs });
      this.write(`${name.padEnd(29, '.')} PASS ${formatDuration(elapsedMs)}`);
      return result;
    } catch (error) {
      const elapsedMs = performance.now() - startedAt;
      this.results.push({ name, outcome: 'FAIL', elapsedMs });
      this.write(`${name.padEnd(29, '.')} FAIL ${formatDuration(elapsedMs)}`);
      this.write(`  ${sanitisedError(error)}`);
      throw error;
    }
  }

  skipRemaining(): void {
    for (const name of STEP_NAMES.slice(this.results.length)) {
      this.results.push({ name, outcome: 'SKIP', elapsedMs: 0 });
      this.write(`${name.padEnd(29, '.')} SKIP`);
    }
  }

  summary(): void {
    const passed = this.results.filter(
      ({ outcome }) => outcome === 'PASS',
    ).length;
    const failed = this.results.filter(
      ({ outcome }) => outcome === 'FAIL',
    ).length;
    const skipped = this.results.filter(
      ({ outcome }) => outcome === 'SKIP',
    ).length;

    this.write('');
    this.write(`${passed} passed, ${failed} failed, ${skipped} skipped`);
    this.write(
      `Duration: ${formatDuration(performance.now() - this.startedAt)}`,
    );
  }
}

function formatDuration(milliseconds: number): string {
  return `${(milliseconds / 1_000).toFixed(1)}s`;
}

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new SmokeFailure(message);
  }
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function redactSecrets(
  value: string,
  explicitSecrets: readonly string[] = [],
): string {
  let redacted = value
    .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      '[JWT REDACTED]',
    )
    .replace(
      /\b(postgres(?:ql)?:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi,
      '$1[REDACTED]@',
    )
    .replace(
      /(["']?(?:password|accessToken|token|secret)["']?\s*[:=]\s*)["'][^"']+["']/gi,
      '$1"[REDACTED]"',
    );

  for (const secret of explicitSecrets.filter(Boolean)) {
    redacted = redacted.replace(
      new RegExp(escapeRegularExpression(secret), 'g'),
      '[REDACTED]',
    );
  }

  return redacted;
}

function sanitisedError(error: unknown): string {
  return redactSecrets(error instanceof Error ? error.message : String(error), [
    DEVELOPMENT_DEMO_PASSWORD,
  ]);
}

function parseDatabaseTarget(
  value: string | undefined,
  name: string,
): DatabaseTarget {
  ensure(value, `${name} is required.`);

  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new SmokeFailure(`${name} must be a valid PostgreSQL URL.`);
  }

  ensure(
    parsed.protocol === 'postgresql:' || parsed.protocol === 'postgres:',
    `${name} must use PostgreSQL.`,
  );
  ensure(
    LOCAL_DATABASE_HOSTS.has(parsed.hostname),
    `${name} must target a local database host.`,
  );
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  ensure(database.length > 0, `${name} must select a database.`);
  ensure(
    !/(^|[_-])(prod(?:uction)?|stag(?:e|ing))($|[_-])/i.test(database),
    `${name} selects a production-like database name.`,
  );

  return {
    host: parsed.hostname,
    port: parsed.port || '5432',
    database,
  };
}

export function assertDatabaseSafety(
  environment: NodeJS.ProcessEnv,
): DatabaseSafetyResult {
  ensure(
    environment.E2E_ALLOW_DATABASE_MUTATION === 'true',
    'Set E2E_ALLOW_DATABASE_MUTATION=true to acknowledge disposable local database mutation.',
  );

  for (const key of ENVIRONMENT_MODE_KEYS) {
    const value = environment[key]?.trim().toLowerCase();
    ensure(
      !value || !PROHIBITED_ENVIRONMENTS.has(value),
      `${key} identifies a prohibited environment mode.`,
    );
  }

  const runtime = parseDatabaseTarget(environment.DATABASE_URL, 'DATABASE_URL');
  const administrative = parseDatabaseTarget(
    environment.DIRECT_DATABASE_URL,
    'DIRECT_DATABASE_URL',
  );
  ensure(
    runtime.host === administrative.host &&
      runtime.port === administrative.port &&
      runtime.database === administrative.database,
    'Runtime and administrative URLs must target the same local database.',
  );

  return { runtime, administrative };
}

export function createUniqueKey(prefix: string): string {
  const safePrefix = prefix.replace(/[^A-Za-z0-9._~:/+-]/g, '-');
  return `${safePrefix}-${randomUUID()}`;
}

export function requireResponseId(value: unknown, label: string): string {
  const id =
    value && typeof value === 'object' && 'id' in value
      ? (value as { id?: unknown }).id
      : undefined;

  ensure(
    typeof id === 'string' && UUID_PATTERN.test(id),
    `${label} response did not contain a valid id.`,
  );
  return id;
}

export async function withCleanup<T>(
  action: (registerCleanup: (cleanup: Cleanup) => void) => Promise<T>,
): Promise<T> {
  const cleanups: Cleanup[] = [];

  try {
    return await action((cleanup) => cleanups.push(cleanup));
  } finally {
    for (const cleanup of cleanups.reverse()) {
      await cleanup();
    }
  }
}

export async function runSmokeCli(
  run: () => Promise<void>,
  write: WriteLine = console.log,
): Promise<number> {
  try {
    await run();
    return 0;
  } catch (error) {
    write(`Backend E2E smoke test failed: ${sanitisedError(error)}`);
    return 1;
  }
}

function headers(
  token: string,
  tenantId?: string,
  idempotencyKey?: string,
): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    ...(tenantId ? { 'X-Tenant-Id': tenantId } : {}),
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
  };
}

function problemSummary(body: unknown): string {
  if (!body || typeof body !== 'object') {
    return 'No Problem Details response was returned.';
  }

  const problem = body as Record<string, unknown>;
  const summary = {
    type: typeof problem.type === 'string' ? problem.type : undefined,
    title: typeof problem.title === 'string' ? problem.title : undefined,
    status: typeof problem.status === 'number' ? problem.status : undefined,
    detail: typeof problem.detail === 'string' ? problem.detail : undefined,
  };

  return JSON.stringify(summary);
}

async function apiRequest(
  baseUrl: string,
  path: string,
  init: RequestInit,
  expectedStatus: number,
): Promise<ApiResult> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const rawBody = await response.text();
  let body: unknown = undefined;

  if (rawBody) {
    try {
      body = JSON.parse(rawBody) as unknown;
    } catch {
      body = undefined;
    }
  }

  if (response.status !== expectedStatus) {
    throw new SmokeFailure(
      `HTTP ${response.status} for ${init.method ?? 'GET'} ${path}; expected ${expectedStatus}. ${problemSummary(body)}`,
    );
  }

  return { status: response.status, body, rawBody };
}

async function expectNotFound(
  baseUrl: string,
  path: string,
  requestHeaders: Record<string, string>,
  forbiddenValue: string,
): Promise<void> {
  const result = await apiRequest(
    baseUrl,
    path,
    { method: 'GET', headers: requestHeaders },
    404,
  );
  ensure(
    !result.rawBody.includes(forbiddenValue),
    'Tenant-neutral denial disclosed protected data.',
  );
}

function jsonRequest(
  method: string,
  requestHeaders: Record<string, string>,
  body: unknown,
): RequestInit {
  return {
    method,
    headers: { ...requestHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function seedUserEmail(userId: string): string {
  const user = USERS.find(({ id }) => id === userId);
  ensure(user, 'Required development seed identity is not defined.');
  return user.email;
}

async function verifyMigrations(adminPrisma: PrismaClient): Promise<void> {
  const migrationsDirectory = new URL(
    '../../../prisma/migrations/',
    import.meta.url,
  );
  const committedMigrations = (
    await readdir(migrationsDirectory, { withFileTypes: true })
  )
    .filter((entry) => entry.isDirectory())
    .map(({ name }) => name)
    .sort();
  const appliedRows = await adminPrisma.$queryRaw<
    Array<{ migration_name: string }>
  >`
    SELECT migration_name
    FROM public._prisma_migrations
    WHERE finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  `;
  const applied = new Set(
    appliedRows.map(({ migration_name }) => migration_name),
  );
  const missing = committedMigrations.filter((name) => !applied.has(name));

  ensure(
    missing.length === 0,
    `Local database is behind by ${missing.length} committed migration(s).`,
  );
}

async function ensureDevelopmentFixtures(
  adminPrisma: PrismaClient,
): Promise<void> {
  const requiredUserIds = [
    SEED_IDS.users.admin,
    SEED_IDS.users.recruiter,
    SEED_IDS.users.compliance,
    SEED_IDS.users.khaleelAdmin,
  ];
  const requiredMemberships = [
    {
      tenantId: SEED_IDS.tenants.zauroh,
      userId: SEED_IDS.users.admin,
    },
    {
      tenantId: SEED_IDS.tenants.zauroh,
      userId: SEED_IDS.users.recruiter,
    },
    {
      tenantId: SEED_IDS.tenants.zauroh,
      userId: SEED_IDS.users.compliance,
    },
    {
      tenantId: SEED_IDS.tenants.khaleel,
      userId: SEED_IDS.users.khaleelAdmin,
    },
  ];
  const fixtureCounts = async () =>
    Promise.all([
      adminPrisma.user.count({ where: { id: { in: requiredUserIds } } }),
      adminPrisma.tenantMembership.count({
        where: { OR: requiredMemberships },
      }),
    ]);
  let [users, memberships] = await fixtureCounts();

  if (
    users !== requiredUserIds.length ||
    memberships !== requiredMemberships.length
  ) {
    await seedDevelopmentData(adminPrisma, () => undefined);
    [users, memberships] = await fixtureCounts();
  }

  ensure(
    users === requiredUserIds.length,
    'Required development users are unavailable after seeding.',
  );
  ensure(
    memberships === requiredMemberships.length,
    'Required development tenant memberships are unavailable after seeding.',
  );
}

async function startApiListener(prisma: PrismaClient): Promise<{
  baseUrl: string;
  server: Server;
}> {
  const app = createApp({ prisma, jwtConfig: readJwtConfig() });
  const server = app.listen(0, '127.0.0.1');

  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address() as AddressInfo | null;
  ensure(address, 'API listener did not expose an address.');

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    server,
  };
}

async function closeServer(server: Server): Promise<void> {
  server.closeIdleConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function expectRuntimeRejection(
  action: () => Promise<unknown>,
): Promise<void> {
  let rejected = false;

  try {
    await action();
  } catch {
    rejected = true;
  }

  ensure(
    rejected,
    'Restricted runtime credentials unexpectedly changed retained evidence.',
  );
}

function isoDate(daysFromToday: number): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + daysFromToday);
  return date.toISOString().slice(0, 10);
}

export async function runBackendSmoke(
  environment: NodeJS.ProcessEnv = process.env,
  write: WriteLine = console.log,
): Promise<void> {
  const reporter = new SmokeReporter(write);
  const runId = randomUUID().replaceAll('-', '');
  const candidateEmail = `e2e-${runId}@example.test`;
  const rawCvMarker = `RAW_CV_${runId}`;
  let failure: unknown;

  write('Backend E2E smoke test');

  try {
    await withCleanup(async (registerCleanup) => {
      const safety = await reporter.step('Database safety', async () => {
        const result = assertDatabaseSafety(environment);
        write(
          `Database: ${result.runtime.host}:${result.runtime.port}/${result.runtime.database} (credentials redacted)`,
        );
        return result;
      });
      const adminPrisma = new PrismaClient({
        datasourceUrl: environment.DIRECT_DATABASE_URL,
      });
      registerCleanup(() => adminPrisma.$disconnect());
      const runtimePrisma = new PrismaClient({
        datasourceUrl: environment.DATABASE_URL,
      });
      registerCleanup(() => runtimePrisma.$disconnect());
      const workerPrisma = new PrismaClient({
        datasourceUrl: environment.DATABASE_URL,
      });
      registerCleanup(() => workerPrisma.$disconnect());

      await reporter.step('Database readiness', async () => {
        await Promise.all([
          adminPrisma.$queryRaw`SELECT 1`,
          runtimePrisma.$queryRaw`SELECT 1`,
          workerPrisma.$queryRaw`SELECT 1`,
        ]);
        await verifyMigrations(adminPrisma);
        await ensureDevelopmentFixtures(adminPrisma);
        ensure(
          safety.runtime.database === safety.administrative.database,
          'Validated database targets diverged.',
        );
      });

      const { baseUrl, server } = await startApiListener(runtimePrisma);
      registerCleanup(() => closeServer(server));

      await reporter.step('API readiness', async () => {
        const result = await apiRequest(
          baseUrl,
          '/health',
          { method: 'GET' },
          200,
        );
        healthResponseSchema.parse(result.body);
      });

      const fixtureEmails = {
        admin: seedUserEmail(SEED_IDS.users.admin),
        recruiter: seedUserEmail(SEED_IDS.users.recruiter),
        compliance: seedUserEmail(SEED_IDS.users.compliance),
        secondAdmin: seedUserEmail(SEED_IDS.users.khaleelAdmin),
      };
      let adminToken = '';
      let recruiterToken = '';
      let complianceToken = '';
      let secondAdminToken = '';

      await reporter.step('Authentication', async () => {
        const login = async (email: string): Promise<string> => {
          const result = await apiRequest(
            baseUrl,
            '/api/v1/auth/login',
            jsonRequest(
              'POST',
              {},
              { email, password: DEVELOPMENT_DEMO_PASSWORD },
            ),
            200,
          );
          return loginResponseSchema.parse(result.body).accessToken;
        };

        [adminToken, recruiterToken, complianceToken, secondAdminToken] =
          await Promise.all([
            login(fixtureEmails.admin),
            login(fixtureEmails.recruiter),
            login(fixtureEmails.compliance),
            login(fixtureEmails.secondAdmin),
          ]);
        const identities = await Promise.all([
          apiRequest(
            baseUrl,
            '/api/v1/auth/me',
            { method: 'GET', headers: headers(adminToken) },
            200,
          ),
          apiRequest(
            baseUrl,
            '/api/v1/auth/me',
            { method: 'GET', headers: headers(recruiterToken) },
            200,
          ),
          apiRequest(
            baseUrl,
            '/api/v1/auth/me',
            { method: 'GET', headers: headers(complianceToken) },
            200,
          ),
        ]);
        identities.forEach(({ body }) => userIdentitySchema.parse(body));
      });

      await reporter.step('Tenant contexts', async () => {
        const contexts = await Promise.all(
          [
            [adminToken, SEED_IDS.tenants.zauroh],
            [recruiterToken, SEED_IDS.tenants.zauroh],
            [complianceToken, SEED_IDS.tenants.zauroh],
            [secondAdminToken, SEED_IDS.tenants.khaleel],
          ].map(([token, tenantId]) =>
            apiRequest(
              baseUrl,
              '/api/v1/context',
              { method: 'GET', headers: headers(token ?? '', tenantId) },
              200,
            ),
          ),
        );
        contexts.forEach(({ body }) => tenantContextSchema.parse(body));
      });

      const candidateBody = {
        fullName: 'Backend E2E Candidate',
        email: candidateEmail,
        roleAppliedFor: 'Senior Software Engineer',
      };
      const candidateKey = createUniqueKey(`candidate-create-${runId}`);
      let candidateId = '';
      let candidateResponse: ReturnType<typeof candidateSchema.parse>;

      await reporter.step('Candidate creation', async () => {
        const result = await apiRequest(
          baseUrl,
          '/api/v1/candidates',
          jsonRequest(
            'POST',
            headers(adminToken, SEED_IDS.tenants.zauroh, candidateKey),
            candidateBody,
          ),
          201,
        );
        candidateResponse = candidateSchema.parse(result.body);
        candidateId = requireResponseId(candidateResponse, 'Candidate');
      });

      await reporter.step('Candidate replay', async () => {
        const result = await apiRequest(
          baseUrl,
          '/api/v1/candidates',
          jsonRequest(
            'POST',
            headers(adminToken, SEED_IDS.tenants.zauroh, candidateKey),
            candidateBody,
          ),
          201,
        );
        const replay = candidateSchema.parse(result.body);
        ensure(
          replay.id === candidateId,
          'Candidate replay returned a different id.',
        );
        const storedCount = await adminPrisma.candidate.count({
          where: { tenantId: SEED_IDS.tenants.zauroh, email: candidateEmail },
        });
        ensure(
          storedCount === 1,
          `Candidate replay stored ${storedCount} rows.`,
        );
      });

      await reporter.step('Candidate read/list', async () => {
        const [getResult, listResult] = await Promise.all([
          apiRequest(
            baseUrl,
            `/api/v1/candidates/${candidateId}`,
            {
              method: 'GET',
              headers: headers(adminToken, SEED_IDS.tenants.zauroh),
            },
            200,
          ),
          apiRequest(
            baseUrl,
            `/api/v1/candidates?email=${encodeURIComponent(candidateEmail)}&page=1&pageSize=20`,
            {
              method: 'GET',
              headers: headers(adminToken, SEED_IDS.tenants.zauroh),
            },
            200,
          ),
        ]);
        ensure(
          candidateSchema.parse(getResult.body).id === candidateId,
          'Candidate GET mismatch.',
        );
        const list = candidateListResponseSchema.parse(listResult.body);
        ensure(
          list.items.length === 1 && list.items[0]?.id === candidateId,
          'Candidate list did not return exactly the created candidate.',
        );
      });

      await reporter.step('Tenant isolation', async () => {
        await expectNotFound(
          baseUrl,
          `/api/v1/candidates/${candidateId}`,
          headers(secondAdminToken, SEED_IDS.tenants.khaleel),
          candidateEmail,
        );
      });

      let documentId = '';
      let approvedDocument: ReturnType<typeof complianceDocumentSchema.parse>;

      await reporter.step('Document creation', async () => {
        const result = await apiRequest(
          baseUrl,
          `/api/v1/candidates/${candidateId}/documents`,
          jsonRequest(
            'POST',
            headers(
              complianceToken,
              SEED_IDS.tenants.zauroh,
              createUniqueKey(`document-create-${runId}`),
            ),
            {
              type: 'RIGHT_TO_WORK',
              issueDate: isoDate(0),
              expiryDate: isoDate(20),
            },
          ),
          201,
        );
        const document = complianceDocumentSchema.parse(result.body);
        documentId = requireResponseId(document, 'Compliance document');
        ensure(
          document.currentVersion.status === 'DRAFT',
          'New document was not DRAFT.',
        );
      });

      const approvalKey = createUniqueKey(`document-approve-${runId}`);

      await reporter.step('Document approval/replay', async () => {
        const approve = async () =>
          apiRequest(
            baseUrl,
            `/api/v1/documents/${documentId}/approve`,
            jsonRequest(
              'POST',
              headers(complianceToken, SEED_IDS.tenants.zauroh, approvalKey),
              {},
            ),
            200,
          );
        const first = complianceDocumentSchema.parse((await approve()).body);
        const replay = complianceDocumentSchema.parse((await approve()).body);
        ensure(
          first.currentVersion.status === 'APPROVED',
          'Approval did not reach APPROVED.',
        );
        ensure(
          JSON.stringify(replay) === JSON.stringify(first),
          'Approval replay changed state.',
        );
        approvedDocument = first;
      });

      await reporter.step('Semantic re-approval', async () => {
        const result = await apiRequest(
          baseUrl,
          `/api/v1/documents/${documentId}/approve`,
          jsonRequest(
            'POST',
            headers(
              complianceToken,
              SEED_IDS.tenants.zauroh,
              createUniqueKey(`document-reapprove-${runId}`),
            ),
            {},
          ),
          200,
        );
        const reapproved = complianceDocumentSchema.parse(result.body);
        ensure(
          JSON.stringify(reapproved) === JSON.stringify(approvedDocument),
          'Semantic re-approval mutated document state.',
        );
      });

      await reporter.step('Expiry endpoint', async () => {
        const result = await apiRequest(
          baseUrl,
          '/api/v1/documents/expiring?page=1&pageSize=100',
          {
            method: 'GET',
            headers: headers(complianceToken, SEED_IDS.tenants.zauroh),
          },
          200,
        );
        const list = candidateDocumentListResponseSchema.parse(result.body);
        ensure(
          list.items.some(({ id }) => id === documentId),
          '20-day document was absent from the expiry endpoint.',
        );
      });

      let verificationId = '';

      await reporter.step('Verification submission', async () => {
        const result = await apiRequest(
          baseUrl,
          `/api/v1/documents/${documentId}/verifications`,
          jsonRequest(
            'POST',
            headers(
              complianceToken,
              SEED_IDS.tenants.zauroh,
              createUniqueKey(`verification-request-${runId}`),
            ),
            {},
          ),
          202,
        );
        const verification = verificationRequestSchema.parse(result.body);
        verificationId = requireResponseId(
          verification,
          'Verification request',
        );
        ensure(
          verification.status === 'requested',
          'Verification did not start as requested.',
        );
      });

      let terminalVerification: ReturnType<
        typeof verificationRequestSchema.parse
      >;

      await reporter.step('Verification worker', async () => {
        const verifier = new DeterministicLocalRightToWorkVerifier();
        const deadline = Date.now() + 15_000;

        while (Date.now() < deadline) {
          await processNextVerificationEvent({
            prisma: workerPrisma,
            verifier,
            workerId: `e2e:${process.pid}:${runId.slice(0, 20)}`,
          });
          const row = await adminPrisma.verificationRequest.findUnique({
            where: { id: verificationId },
          });

          if (row?.status === 'VERIFIED' || row?.status === 'FAILED') {
            terminalVerification = verificationRequestSchema.parse({
              id: row.id,
              documentId: row.documentId,
              documentVersionId: row.documentVersionId,
              status: row.status.toLowerCase(),
              attemptCount: row.attemptCount,
              failureCode: row.failureCode,
              requestedAt: row.requestedAt.toISOString(),
              startedAt: row.startedAt?.toISOString() ?? null,
              completedAt: row.completedAt?.toISOString() ?? null,
              updatedAt: row.updatedAt.toISOString(),
            });
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        ensure(
          terminalVerification,
          'Verification did not reach a terminal state in 15 seconds.',
        );
        const outbox = await adminPrisma.outboxEvent.findFirst({
          where: { verificationRequestId: verificationId },
        });
        ensure(
          outbox?.processedAt,
          'Verification outbox event was not marked processed.',
        );
      });

      await reporter.step('Verification read', async () => {
        const result = await apiRequest(
          baseUrl,
          `/api/v1/verifications/${verificationId}`,
          {
            method: 'GET',
            headers: headers(complianceToken, SEED_IDS.tenants.zauroh),
          },
          200,
        );
        const verification = verificationRequestSchema.parse(result.body);
        ensure(
          verification.status === terminalVerification.status,
          'Verification API did not return the terminal worker state.',
        );
      });

      const cvText = [
        'Full name: Backend E2E Candidate',
        'Skills: TypeScript, Node.js, PostgreSQL, React',
        'Years of experience: 8',
        'Certifications: AWS Certified Developer',
        `Internal marker: ${rawCvMarker}`,
      ].join('\n');
      let extractionId = '';

      await reporter.step('CV proposal', async () => {
        const result = await apiRequest(
          baseUrl,
          `/api/v1/candidates/${candidateId}/cv-extractions`,
          {
            method: 'POST',
            headers: {
              ...headers(
                recruiterToken,
                SEED_IDS.tenants.zauroh,
                createUniqueKey(`cv-extract-${runId}`),
              ),
              'Content-Type': 'text/plain',
            },
            body: cvText,
          },
          201,
        );
        const extraction = cvExtractionSchema.parse(result.body);
        extractionId = requireResponseId(extraction, 'CV extraction');
        ensure(
          extraction.status === 'PROPOSED',
          'CV extraction was not PROPOSED.',
        );
        ensure(
          extraction.confirmedOutput === null,
          'Proposal was authoritative before confirmation.',
        );
      });

      await reporter.step('CV pre-confirmation', async () => {
        const profiles = await adminPrisma.candidateProfile.count({
          where: { tenantId: SEED_IDS.tenants.zauroh, candidateId },
        });
        ensure(
          profiles === 0,
          'Candidate profile existed before confirmation.',
        );
        const candidate = await apiRequest(
          baseUrl,
          `/api/v1/candidates/${candidateId}`,
          {
            method: 'GET',
            headers: headers(recruiterToken, SEED_IDS.tenants.zauroh),
          },
          200,
        );
        ensure(
          candidateSchema.parse(candidate.body).id === candidateId,
          'Candidate became unavailable.',
        );
      });

      await reporter.step('CV retrieval', async () => {
        const result = await apiRequest(
          baseUrl,
          `/api/v1/cv-extractions/${extractionId}`,
          {
            method: 'GET',
            headers: headers(recruiterToken, SEED_IDS.tenants.zauroh),
          },
          200,
        );
        const extraction = cvExtractionSchema.parse(result.body);
        ensure(
          extraction.status === 'PROPOSED',
          'Retrieved extraction was not PROPOSED.',
        );
      });

      await reporter.step('CV confirmation', async () => {
        const confirmedProfile = {
          fullName: 'Backend E2E Candidate',
          skills: ['TypeScript', 'Node.js', 'PostgreSQL', 'React'],
          yearsOfExperience: 8,
          certifications: ['AWS Certified Developer'],
        };
        const result = await apiRequest(
          baseUrl,
          `/api/v1/cv-extractions/${extractionId}/confirm`,
          jsonRequest(
            'POST',
            headers(
              recruiterToken,
              SEED_IDS.tenants.zauroh,
              createUniqueKey(`cv-confirm-${runId}`),
            ),
            confirmedProfile,
          ),
          200,
        );
        const confirmed = cvExtractionSchema.parse(result.body);
        ensure(
          confirmed.status === 'ACCEPTED',
          'CV extraction was not ACCEPTED.',
        );
        ensure(
          JSON.stringify(confirmed.confirmedOutput) ===
            JSON.stringify(confirmedProfile),
          'Confirmed profile did not match validated recruiter data.',
        );
        const profile = await adminPrisma.candidateProfile.findUnique({
          where: {
            tenantId_candidateId: {
              tenantId: SEED_IDS.tenants.zauroh,
              candidateId,
            },
          },
        });
        ensure(
          profile?.sourceExtractionId === extractionId,
          'Authoritative profile was not linked to accepted evidence.',
        );
      });

      const documentRemoveKey = createUniqueKey(`document-remove-${runId}`);

      await reporter.step('Document removal/replay', async () => {
        const remove = async () =>
          apiRequest(
            baseUrl,
            `/api/v1/documents/${documentId}`,
            {
              method: 'DELETE',
              headers: headers(
                complianceToken,
                SEED_IDS.tenants.zauroh,
                documentRemoveKey,
              ),
            },
            204,
          );
        const first = await remove();
        const replay = await remove();
        ensure(
          !first.rawBody && !replay.rawBody,
          'Document DELETE returned a body.',
        );
      });

      await reporter.step('Removed document denial', async () => {
        await expectNotFound(
          baseUrl,
          `/api/v1/documents/${documentId}`,
          headers(complianceToken, SEED_IDS.tenants.zauroh),
          documentId,
        );
      });

      const candidateRemoveKey = createUniqueKey(`candidate-remove-${runId}`);

      await reporter.step('Candidate removal/replay', async () => {
        const remove = async () =>
          apiRequest(
            baseUrl,
            `/api/v1/candidates/${candidateId}`,
            {
              method: 'DELETE',
              headers: headers(
                adminToken,
                SEED_IDS.tenants.zauroh,
                candidateRemoveKey,
              ),
            },
            204,
          );
        const first = await remove();
        const replay = await remove();
        ensure(
          !first.rawBody && !replay.rawBody,
          'Candidate DELETE returned a body.',
        );
      });

      await reporter.step('Removed candidate denial', async () => {
        await expectNotFound(
          baseUrl,
          `/api/v1/candidates/${candidateId}`,
          headers(adminToken, SEED_IDS.tenants.zauroh),
          candidateEmail,
        );
      });

      let representativeAuditId = '';

      await reporter.step('Audit evidence', async () => {
        const audits = await adminPrisma.auditEvent.findMany({
          where: {
            tenantId: SEED_IDS.tenants.zauroh,
            recordId: {
              in: [candidateId, documentId, verificationId, extractionId],
            },
          },
        });
        const actions = new Set(audits.map(({ action }) => action));
        const expectedActions = [
          AUDIT_ACTIONS.candidateCreate,
          AUDIT_ACTIONS.candidateRemove,
          AUDIT_ACTIONS.documentCreate,
          AUDIT_ACTIONS.documentRemove,
          AUDIT_ACTIONS.verificationRequest,
          AUDIT_ACTIONS.aiExtract,
          AUDIT_ACTIONS.aiConfirm,
        ];

        expectedActions.forEach((action) =>
          ensure(
            actions.has(action),
            `Missing representative ${action} audit evidence.`,
          ),
        );
        ensure(
          actions.has(AUDIT_ACTIONS.verificationVerified) ||
            actions.has(AUDIT_ACTIONS.verificationFailed),
          'Missing terminal verification audit evidence.',
        );
        const approvalEvents = audits.filter(
          ({ action, recordId }) =>
            action === AUDIT_ACTIONS.documentApprove && recordId === documentId,
        );
        ensure(
          approvalEvents.length === 2,
          `Expected 2 approval events, found ${approvalEvents.length}.`,
        );
        const semanticApproval = approvalEvents.find(
          ({ metadata }) =>
            (metadata as { outcome?: string }).outcome === 'ALREADY_APPROVED',
        );
        ensure(
          semanticApproval,
          'Semantic re-approval audit evidence was missing.',
        );
        ensure(
          semanticApproval.beforeHash === semanticApproval.afterHash,
          'Semantic re-approval hashes were not equal.',
        );
        ensure(
          !JSON.stringify(audits.map(({ metadata }) => metadata)).includes(
            rawCvMarker,
          ),
          'Raw CV content appeared in audit metadata.',
        );
        representativeAuditId = audits[0]?.id ?? '';
        ensure(
          representativeAuditId,
          'No audit event was available for privilege checks.',
        );
      });

      await reporter.step('Retained history', async () => {
        const [
          candidate,
          document,
          versions,
          verification,
          extraction,
          profile,
        ] = await Promise.all([
          adminPrisma.candidate.findUnique({ where: { id: candidateId } }),
          adminPrisma.complianceDocument.findUnique({
            where: { id: documentId },
          }),
          adminPrisma.complianceDocumentVersion.count({
            where: { documentId },
          }),
          adminPrisma.verificationRequest.findUnique({
            where: { id: verificationId },
          }),
          adminPrisma.cvExtraction.findUnique({ where: { id: extractionId } }),
          adminPrisma.candidateProfile.findUnique({
            where: {
              tenantId_candidateId: {
                tenantId: SEED_IDS.tenants.zauroh,
                candidateId,
              },
            },
          }),
        ]);

        ensure(
          candidate?.removedAt,
          'Candidate row was not retained as removed.',
        );
        ensure(
          document?.removedAt,
          'Document row was not retained as removed.',
        );
        ensure(versions >= 1, 'Document version history was not retained.');
        ensure(verification, 'Verification history was not retained.');
        ensure(extraction, 'CV extraction evidence was not retained.');
        ensure(
          profile?.sourceExtractionId === extractionId,
          'Confirmed profile was not retained.',
        );
      });

      await reporter.step('Runtime protections', async () => {
        await expectRuntimeRejection(() =>
          withTenantTransaction(
            runtimePrisma,
            { tenantId: SEED_IDS.tenants.zauroh },
            (transaction) =>
              transaction.auditEvent.update({
                where: { id: representativeAuditId },
                data: { metadata: { tampered: true } },
              }),
          ),
        );
        await expectRuntimeRejection(() =>
          withTenantTransaction(
            runtimePrisma,
            { tenantId: SEED_IDS.tenants.zauroh },
            (transaction) =>
              transaction.auditEvent.delete({
                where: { id: representativeAuditId },
              }),
          ),
        );
        await expectRuntimeRejection(() =>
          withTenantTransaction(
            runtimePrisma,
            { tenantId: SEED_IDS.tenants.zauroh },
            (transaction) =>
              transaction.candidate.delete({ where: { id: candidateId } }),
          ),
        );
        await expectRuntimeRejection(() =>
          withTenantTransaction(
            runtimePrisma,
            { tenantId: SEED_IDS.tenants.zauroh },
            (transaction) =>
              transaction.complianceDocument.delete({
                where: { id: documentId },
              }),
          ),
        );
      });
    });
  } catch (error) {
    failure = error;
    reporter.skipRemaining();
  } finally {
    reporter.summary();
  }

  if (failure) {
    throw failure;
  }
}

const entryPoint = process.argv[1];

if (entryPoint && pathToFileURL(entryPoint).href === import.meta.url) {
  loadEnvironment();
  process.exitCode = await runSmokeCli(() => runBackendSmoke());
}

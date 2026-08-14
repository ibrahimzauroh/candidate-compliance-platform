import {
  candidateSchema,
  type TenantContext,
} from '@candidate-compliance/contracts';
import { PrismaClient, TenantRole } from '@prisma/client';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { loadEnvironment } from '../../config/load-environment.js';
import {
  executeIdempotentWrite,
  IDEMPOTENCY_OPERATIONS,
} from './idempotency.service.js';

loadEnvironment();

const runtimePrisma = new PrismaClient();
const adminPrisma = new PrismaClient({
  datasourceUrl: process.env.DIRECT_DATABASE_URL,
});
const jwtConfig = {
  secret: 'idempotency-integration-test-secret-value',
  expiresIn: '15m' as const,
};
const app = createApp({ prisma: runtimePrisma, jwtConfig });

const ids = {
  tenants: {
    zauroh: '10000000-0000-4000-8000-000000000001',
    khaleel: '10000000-0000-4000-8000-000000000002',
  },
  users: {
    zaurohAdmin: '20000000-0000-4000-8000-000000000001',
    recruiter: '20000000-0000-4000-8000-000000000002',
    khaleelAdmin: '20000000-0000-4000-8000-000000000005',
  },
  memberships: {
    zaurohAdmin: '30000000-0000-4000-8000-000000000001',
    zaurohRecruiter: '30000000-0000-4000-8000-000000000002',
    khaleelAdmin: '30000000-0000-4000-8000-000000000006',
    nonexistent: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  },
  candidates: {
    zaurohDocumentOwner: '43000000-0000-4000-8000-000000000001',
    khaleelDocumentOwner: '43000000-0000-4000-8000-000000000002',
    nonexistent: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  },
} as const;

const zaurohAdminContext: TenantContext = {
  tenantId: ids.tenants.zauroh,
  userId: ids.users.zaurohAdmin,
  membershipId: ids.memberships.zaurohAdmin,
  role: TenantRole.ADMIN,
};

const requiredProblem = {
  type: 'about:blank',
  title: 'Bad Request',
  status: 400,
  detail: 'Idempotency-Key header is required.',
};
const invalidProblem = {
  type: 'about:blank',
  title: 'Bad Request',
  status: 400,
  detail: 'Idempotency-Key must contain 1 to 200 supported opaque characters.',
};
const conflictProblem = {
  type: 'about:blank',
  title: 'Conflict',
  status: 409,
  detail: 'This Idempotency-Key has already been used for a different request.',
};

function tokenFor(userId: string): string {
  return jwt.sign({}, jwtConfig.secret, {
    algorithm: 'HS256',
    expiresIn: jwtConfig.expiresIn,
    subject: userId,
  });
}

function candidateInput(name: string) {
  return {
    fullName: `${name} Candidate`,
    email: `${name.toLowerCase()}@phase2d.test`,
    roleAppliedFor: 'Idempotency Specialist',
  };
}

function documentInput(expiryDate = '2027-08-01') {
  return {
    type: 'RIGHT_TO_WORK',
    issueDate: '2026-08-01',
    expiryDate,
  };
}

function authenticatedWrite(
  method: 'post' | 'patch',
  path: string,
  userId: string,
  tenantId: string,
  key?: string,
) {
  const agent = request(app);
  const pendingRequest =
    method === 'post' ? agent.post(path) : agent.patch(path);
  pendingRequest
    .set('Authorization', `Bearer ${tokenFor(userId)}`)
    .set('X-Tenant-Id', tenantId);

  if (key !== undefined) {
    pendingRequest.set('Idempotency-Key', key);
  }

  return pendingRequest;
}

function createCandidateRequest(
  key: string | undefined,
  name: string,
  userId: string = ids.users.zaurohAdmin,
  tenantId: string = ids.tenants.zauroh,
) {
  return authenticatedWrite(
    'post',
    '/api/v1/candidates',
    userId,
    tenantId,
    key,
  ).send(candidateInput(name));
}

async function cleanFixtures(): Promise<void> {
  await adminPrisma.idempotencyRecord.deleteMany({
    where: { key: { startsWith: 'phase2d-' } },
  });
  const documents = await adminPrisma.complianceDocument.findMany({
    where: {
      candidateId: {
        in: [
          ids.candidates.zaurohDocumentOwner,
          ids.candidates.khaleelDocumentOwner,
        ],
      },
    },
    select: { id: true },
  });
  const documentIds = documents.map(({ id }) => id);

  if (documentIds.length > 0) {
    await adminPrisma.complianceDocument.updateMany({
      where: { id: { in: documentIds } },
      data: { currentVersionId: null },
    });
    await adminPrisma.complianceDocumentVersion.deleteMany({
      where: { documentId: { in: documentIds } },
    });
    await adminPrisma.complianceDocument.deleteMany({
      where: { id: { in: documentIds } },
    });
  }

  await adminPrisma.candidate.deleteMany({
    where: { email: { endsWith: '@phase2d.test' } },
  });
}

async function createDocumentOwners(): Promise<void> {
  await adminPrisma.candidate.createMany({
    data: [
      {
        id: ids.candidates.zaurohDocumentOwner,
        tenantId: ids.tenants.zauroh,
        fullName: 'Zauroh Document Owner',
        email: 'zauroh.document.owner@phase2d.test',
        roleAppliedFor: 'Care Coordinator',
      },
      {
        id: ids.candidates.khaleelDocumentOwner,
        tenantId: ids.tenants.khaleel,
        fullName: 'Khaleel Document Owner',
        email: 'khaleel.document.owner@phase2d.test',
        roleAppliedFor: 'Support Worker',
      },
    ],
  });
}

beforeAll(async () => {
  const memberships = await adminPrisma.tenantMembership.count({
    where: {
      id: {
        in: [ids.memberships.zaurohAdmin, ids.memberships.khaleelAdmin],
      },
    },
  });
  if (memberships !== 2) {
    throw new Error('Run pnpm db:seed before idempotency integration tests.');
  }
});

beforeEach(async () => {
  await cleanFixtures();
  await createDocumentOwners();
});

afterAll(async () => {
  await cleanFixtures();
  await Promise.all([runtimePrisma.$disconnect(), adminPrisma.$disconnect()]);
});

describe('Idempotency-Key validation', () => {
  it('rejects missing, blank, oversized, and unsafe keys with 400', async () => {
    const [missing, blank, oversized, unsafe] = await Promise.all([
      createCandidateRequest(undefined, 'Missing'),
      createCandidateRequest('   ', 'Blank'),
      createCandidateRequest('a'.repeat(201), 'Oversized'),
      createCandidateRequest('unsafe key', 'Unsafe'),
    ]);

    expect(missing.status).toBe(400);
    expect(missing.body).toEqual(requiredProblem);
    for (const response of [blank, oversized, unsafe]) {
      expect(response.status).toBe(400);
      expect(response.body).toEqual(invalidProblem);
    }
    await expect(
      adminPrisma.idempotencyRecord.count({
        where: { key: { startsWith: 'phase2d-' } },
      }),
    ).resolves.toBe(0);
  });
});

describe('candidate write replay', () => {
  it('replays candidate creation with the original 201 response exactly once', async () => {
    const key = 'phase2d-candidate-create-replay';
    const first = await createCandidateRequest(key, 'CreateReplay');
    const retry = await createCandidateRequest(key, 'CreateReplay');

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body).toEqual(first.body);
    await expect(
      adminPrisma.candidate.count({
        where: { email: 'createreplay@phase2d.test' },
      }),
    ).resolves.toBe(1);
  });

  it('returns 409 when a candidate-create key is reused for a different payload', async () => {
    const key = 'phase2d-candidate-create-conflict';
    expect((await createCandidateRequest(key, 'Original')).status).toBe(201);

    const conflict = await createCandidateRequest(key, 'Different');

    expect(conflict.status).toBe(409);
    expect(conflict.body).toEqual(conflictProblem);
    await expect(
      adminPrisma.candidate.count({
        where: {
          email: { in: ['original@phase2d.test', 'different@phase2d.test'] },
        },
      }),
    ).resolves.toBe(1);
  });

  it('replays PATCH with its original 200 response and rejects changed input', async () => {
    const created = await createCandidateRequest(
      'phase2d-patch-setup',
      'PatchTarget',
    );
    const key = 'phase2d-patch-replay';
    const path = `/api/v1/candidates/${created.body.id}`;
    const first = await authenticatedWrite(
      'patch',
      path,
      ids.users.zaurohAdmin,
      ids.tenants.zauroh,
      key,
    ).send({ fullName: 'Patched Once' });
    const laterMutation = await authenticatedWrite(
      'patch',
      path,
      ids.users.zaurohAdmin,
      ids.tenants.zauroh,
      'phase2d-patch-later-mutation',
    ).send({ roleAppliedFor: 'Later Role' });
    const retry = await authenticatedWrite(
      'patch',
      path,
      ids.users.zaurohAdmin,
      ids.tenants.zauroh,
      key,
    ).send({ fullName: 'Patched Once' });
    const conflict = await authenticatedWrite(
      'patch',
      path,
      ids.users.zaurohAdmin,
      ids.tenants.zauroh,
      key,
    ).send({ fullName: 'Patched Twice' });

    expect(first.status).toBe(200);
    expect(laterMutation.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual(first.body);
    expect(retry.body.roleAppliedFor).toBe('Idempotency Specialist');
    expect(conflict.status).toBe(409);
    expect(conflict.body).toEqual(conflictProblem);
    await expect(
      adminPrisma.candidate.findUnique({ where: { id: created.body.id } }),
    ).resolves.toMatchObject({
      fullName: 'Patched Once',
      roleAppliedFor: 'Later Role',
    });
  });
});

describe('compliance document write replay', () => {
  it('replays document creation without duplicating the document or version', async () => {
    const key = 'phase2d-document-create-replay';
    const path = `/api/v1/candidates/${ids.candidates.zaurohDocumentOwner}/documents`;
    const first = await authenticatedWrite(
      'post',
      path,
      ids.users.zaurohAdmin,
      ids.tenants.zauroh,
      key,
    ).send(documentInput());
    const retry = await authenticatedWrite(
      'post',
      path,
      ids.users.zaurohAdmin,
      ids.tenants.zauroh,
      key,
    ).send(documentInput());

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body).toEqual(first.body);
    await expect(
      adminPrisma.complianceDocument.count({
        where: { candidateId: ids.candidates.zaurohDocumentOwner },
      }),
    ).resolves.toBe(1);
    await expect(
      adminPrisma.complianceDocumentVersion.count({
        where: { documentId: first.body.id },
      }),
    ).resolves.toBe(1);
  });

  it('returns 409 when a document-create key is reused for different input', async () => {
    const key = 'phase2d-document-create-conflict';
    const path = `/api/v1/candidates/${ids.candidates.zaurohDocumentOwner}/documents`;
    expect(
      (
        await authenticatedWrite(
          'post',
          path,
          ids.users.zaurohAdmin,
          ids.tenants.zauroh,
          key,
        ).send(documentInput())
      ).status,
    ).toBe(201);

    const conflict = await authenticatedWrite(
      'post',
      path,
      ids.users.zaurohAdmin,
      ids.tenants.zauroh,
      key,
    ).send(documentInput('2028-08-01'));

    expect(conflict.status).toBe(409);
    expect(conflict.body).toEqual(conflictProblem);
  });

  it.each([
    [
      'omitted dates followed by explicit null dates',
      { type: 'RIGHT_TO_WORK' },
      { type: 'RIGHT_TO_WORK', issueDate: null, expiryDate: null },
    ],
    [
      'explicit null dates followed by omitted dates',
      { type: 'RIGHT_TO_WORK', issueDate: null, expiryDate: null },
      { type: 'RIGHT_TO_WORK' },
    ],
  ])(
    'replays document creation for %s',
    async (_direction, firstInput, retryInput) => {
      const key = `phase2d-document-semantic-${_direction.replaceAll(' ', '-')}`;
      const path = `/api/v1/candidates/${ids.candidates.zaurohDocumentOwner}/documents`;
      const first = await authenticatedWrite(
        'post',
        path,
        ids.users.zaurohAdmin,
        ids.tenants.zauroh,
        key,
      ).send(firstInput);
      const retry = await authenticatedWrite(
        'post',
        path,
        ids.users.zaurohAdmin,
        ids.tenants.zauroh,
        key,
      ).send(retryInput);

      expect(first.status).toBe(201);
      expect(retry.status).toBe(201);
      expect(retry.body).toEqual(first.body);
      await expect(
        adminPrisma.complianceDocument.count({
          where: { candidateId: ids.candidates.zaurohDocumentOwner },
        }),
      ).resolves.toBe(1);
      await expect(
        adminPrisma.complianceDocumentVersion.count({
          where: { documentId: first.body.id },
        }),
      ).resolves.toBe(1);
    },
  );

  it('replays version creation without incrementing again and rejects changed input', async () => {
    const document = await authenticatedWrite(
      'post',
      `/api/v1/candidates/${ids.candidates.zaurohDocumentOwner}/documents`,
      ids.users.zaurohAdmin,
      ids.tenants.zauroh,
      'phase2d-version-setup',
    ).send(documentInput());
    const key = 'phase2d-version-replay';
    const path = `/api/v1/documents/${document.body.id}/versions`;
    const input = { issueDate: '2026-09-01', expiryDate: '2027-09-01' };
    const first = await authenticatedWrite(
      'post',
      path,
      ids.users.zaurohAdmin,
      ids.tenants.zauroh,
      key,
    ).send(input);
    const retry = await authenticatedWrite(
      'post',
      path,
      ids.users.zaurohAdmin,
      ids.tenants.zauroh,
      key,
    ).send(input);
    const conflict = await authenticatedWrite(
      'post',
      path,
      ids.users.zaurohAdmin,
      ids.tenants.zauroh,
      key,
    ).send({ ...input, expiryDate: '2028-09-01' });

    expect(first.status).toBe(201);
    expect(first.body.currentVersion.versionNumber).toBe(2);
    expect(retry.status).toBe(201);
    expect(retry.body).toEqual(first.body);
    expect(conflict.status).toBe(409);
    expect(conflict.body).toEqual(conflictProblem);
    await expect(
      adminPrisma.complianceDocumentVersion.count({
        where: { documentId: document.body.id },
      }),
    ).resolves.toBe(2);
  });

  it.each([
    [
      'omitted dates followed by explicit null dates',
      {},
      { issueDate: null, expiryDate: null },
    ],
    [
      'explicit null dates followed by omitted dates',
      { issueDate: null, expiryDate: null },
      {},
    ],
  ])(
    'replays version creation for %s',
    async (_direction, firstInput, retryInput) => {
      const document = await authenticatedWrite(
        'post',
        `/api/v1/candidates/${ids.candidates.zaurohDocumentOwner}/documents`,
        ids.users.zaurohAdmin,
        ids.tenants.zauroh,
        `phase2d-version-semantic-setup-${_direction.replaceAll(' ', '-')}`,
      ).send(documentInput());
      const key = `phase2d-version-semantic-${_direction.replaceAll(' ', '-')}`;
      const path = `/api/v1/documents/${document.body.id}/versions`;
      const first = await authenticatedWrite(
        'post',
        path,
        ids.users.zaurohAdmin,
        ids.tenants.zauroh,
        key,
      ).send(firstInput);
      const retry = await authenticatedWrite(
        'post',
        path,
        ids.users.zaurohAdmin,
        ids.tenants.zauroh,
        key,
      ).send(retryInput);

      expect(first.status).toBe(201);
      expect(first.body.currentVersion.versionNumber).toBe(2);
      expect(retry.status).toBe(201);
      expect(retry.body).toEqual(first.body);
      await expect(
        adminPrisma.complianceDocumentVersion.count({
          where: { documentId: document.body.id },
        }),
      ).resolves.toBe(2);
    },
  );
});

describe('trusted idempotency scope', () => {
  it('allows the same textual key in different tenants without replaying across them', async () => {
    const key = 'phase2d-cross-tenant';
    const zauroh = await createCandidateRequest(key, 'TenantScoped');
    const khaleel = await createCandidateRequest(
      key,
      'TenantScoped',
      ids.users.khaleelAdmin,
      ids.tenants.khaleel,
    );

    expect(zauroh.status).toBe(201);
    expect(khaleel.status).toBe(201);
    expect(khaleel.body.id).not.toBe(zauroh.body.id);
    const records = await adminPrisma.idempotencyRecord.findMany({
      where: { key },
      orderBy: { tenantId: 'asc' },
    });
    expect(records.map(({ tenantId }) => tenantId)).toEqual([
      ids.tenants.zauroh,
      ids.tenants.khaleel,
    ]);
  });

  it('allows the same textual key for different trusted operations', async () => {
    const key = 'phase2d-cross-operation';
    const created = await createCandidateRequest(key, 'OperationScoped');
    const updated = await authenticatedWrite(
      'patch',
      `/api/v1/candidates/${created.body.id}`,
      ids.users.zaurohAdmin,
      ids.tenants.zauroh,
      key,
    ).send({ fullName: 'Operation Scoped Update' });

    expect(created.status).toBe(201);
    expect(updated.status).toBe(200);
    await expect(
      adminPrisma.idempotencyRecord.count({ where: { key } }),
    ).resolves.toBe(2);
  });

  it('scopes the same key independently to validated memberships in one tenant', async () => {
    const key = 'phase2d-cross-actor';
    const admin = await createCandidateRequest(key, 'AdminActor');
    const recruiter = await createCandidateRequest(
      key,
      'RecruiterActor',
      ids.users.recruiter,
      ids.tenants.zauroh,
    );

    expect(admin.status).toBe(201);
    expect(recruiter.status).toBe(201);
    expect(recruiter.body.id).not.toBe(admin.body.id);
    const records = await adminPrisma.idempotencyRecord.findMany({
      where: { key },
      orderBy: { membershipId: 'asc' },
    });
    expect(records.map(({ membershipId }) => membershipId)).toEqual([
      ids.memberships.zaurohAdmin,
      ids.memberships.zaurohRecruiter,
    ]);
  });

  it('rejects client tenant/user scope fields before creating a record', async () => {
    const key = 'phase2d-client-scope-injection';
    const response = await authenticatedWrite(
      'post',
      '/api/v1/candidates',
      ids.users.zaurohAdmin,
      ids.tenants.zauroh,
      key,
    ).send({
      ...candidateInput('InjectedScope'),
      tenantId: ids.tenants.khaleel,
      userId: ids.users.khaleelAdmin,
    });

    expect(response.status).toBe(400);
    await expect(
      adminPrisma.idempotencyRecord.count({ where: { key } }),
    ).resolves.toBe(0);
  });

  it('canonicalises nested object keys independently of insertion order', async () => {
    const key = 'phase2d-nested-canonical-order';
    let executions = 0;
    const run = (fingerprintInput: unknown) =>
      executeIdempotentWrite({
        prisma: runtimePrisma,
        tenantContext: zaurohAdminContext,
        key,
        operation: IDEMPOTENCY_OPERATIONS.candidateUpdate,
        fingerprintInput,
        responseStatus: 200,
        parseResponse: (value) => value as { result: string },
        execute: async () => {
          executions += 1;
          return { result: 'canonical' };
        },
      });

    const first = await run({
      outerZ: { nestedZ: 2, nestedA: 1 },
      outerA: true,
    });
    const retry = await run({
      outerA: true,
      outerZ: { nestedA: 1, nestedZ: 2 },
    });

    expect(first.replayed).toBe(false);
    expect(retry.replayed).toBe(true);
    expect(retry.body).toEqual(first.body);
    expect(executions).toBe(1);
  });
});

describe('same-key concurrency', () => {
  it('creates one candidate for two concurrent identical requests', async () => {
    const key = 'phase2d-concurrent-candidate';
    const [left, right] = await Promise.all([
      createCandidateRequest(key, 'ConcurrentCandidate'),
      createCandidateRequest(key, 'ConcurrentCandidate'),
    ]);

    expect(left.status).toBe(201);
    expect(right.status).toBe(201);
    expect(right.body).toEqual(left.body);
    await expect(
      adminPrisma.candidate.count({
        where: { email: 'concurrentcandidate@phase2d.test' },
      }),
    ).resolves.toBe(1);
    await expect(
      adminPrisma.idempotencyRecord.count({ where: { key } }),
    ).resolves.toBe(1);
  });

  it('creates one document and initial version for concurrent identical requests', async () => {
    const key = 'phase2d-concurrent-document';
    const path = `/api/v1/candidates/${ids.candidates.zaurohDocumentOwner}/documents`;
    const input = documentInput();
    const [left, right] = await Promise.all([
      authenticatedWrite(
        'post',
        path,
        ids.users.zaurohAdmin,
        ids.tenants.zauroh,
        key,
      ).send(input),
      authenticatedWrite(
        'post',
        path,
        ids.users.zaurohAdmin,
        ids.tenants.zauroh,
        key,
      ).send(input),
    ]);

    expect(left.status).toBe(201);
    expect(right.status).toBe(201);
    expect(right.body).toEqual(left.body);
    await expect(
      adminPrisma.complianceDocument.count({
        where: { candidateId: ids.candidates.zaurohDocumentOwner },
      }),
    ).resolves.toBe(1);
    await expect(
      adminPrisma.complianceDocumentVersion.count({
        where: { documentId: left.body.id },
      }),
    ).resolves.toBe(1);
  });

  it('commits one winner for concurrent conflicting document payloads', async () => {
    const key = 'phase2d-concurrent-document-conflict';
    const path = `/api/v1/candidates/${ids.candidates.zaurohDocumentOwner}/documents`;
    const leftInput = documentInput('2027-08-01');
    const rightInput = documentInput('2028-08-01');
    const [leftResponse, rightResponse] = await Promise.all([
      authenticatedWrite(
        'post',
        path,
        ids.users.zaurohAdmin,
        ids.tenants.zauroh,
        key,
      ).send(leftInput),
      authenticatedWrite(
        'post',
        path,
        ids.users.zaurohAdmin,
        ids.tenants.zauroh,
        key,
      ).send(rightInput),
    ]);
    const attempts = [
      { input: leftInput, response: leftResponse },
      { input: rightInput, response: rightResponse },
    ];
    const successful = attempts.filter(
      ({ response }) => response.status === 201,
    );
    const conflicted = attempts.filter(
      ({ response }) => response.status === 409,
    );

    expect(successful).toHaveLength(1);
    expect(conflicted).toHaveLength(1);
    expect(conflicted[0]?.response.body).toEqual(conflictProblem);
    await expect(
      adminPrisma.complianceDocument.count({
        where: { candidateId: ids.candidates.zaurohDocumentOwner },
      }),
    ).resolves.toBe(1);
    await expect(
      adminPrisma.complianceDocumentVersion.count({
        where: {
          document: { candidateId: ids.candidates.zaurohDocumentOwner },
        },
      }),
    ).resolves.toBe(1);

    const record = await adminPrisma.idempotencyRecord.findFirstOrThrow({
      where: { key },
    });
    expect(record.responseBody).toEqual(successful[0]?.response.body);

    const successfulReplay = await authenticatedWrite(
      'post',
      path,
      ids.users.zaurohAdmin,
      ids.tenants.zauroh,
      key,
    ).send(successful[0]?.input);
    const losingReplay = await authenticatedWrite(
      'post',
      path,
      ids.users.zaurohAdmin,
      ids.tenants.zauroh,
      key,
    ).send(conflicted[0]?.input);

    expect(successfulReplay.status).toBe(201);
    expect(successfulReplay.body).toEqual(successful[0]?.response.body);
    expect(losingReplay.status).toBe(409);
    expect(losingReplay.body).toEqual(conflictProblem);
  });

  it('creates one new version for two concurrent identical requests', async () => {
    const document = await authenticatedWrite(
      'post',
      `/api/v1/candidates/${ids.candidates.zaurohDocumentOwner}/documents`,
      ids.users.zaurohAdmin,
      ids.tenants.zauroh,
      'phase2d-concurrent-version-setup',
    ).send(documentInput());
    const key = 'phase2d-concurrent-version';
    const path = `/api/v1/documents/${document.body.id}/versions`;
    const input = { issueDate: '2026-10-01', expiryDate: '2027-10-01' };
    const [left, right] = await Promise.all([
      authenticatedWrite(
        'post',
        path,
        ids.users.zaurohAdmin,
        ids.tenants.zauroh,
        key,
      ).send(input),
      authenticatedWrite(
        'post',
        path,
        ids.users.zaurohAdmin,
        ids.tenants.zauroh,
        key,
      ).send(input),
    ]);

    expect(left.status).toBe(201);
    expect(right.status).toBe(201);
    expect(right.body).toEqual(left.body);
    expect(left.body.currentVersion.versionNumber).toBe(2);
    await expect(
      adminPrisma.complianceDocumentVersion.count({
        where: { documentId: document.body.id },
      }),
    ).resolves.toBe(2);
  });
});

describe('atomic idempotency persistence', () => {
  it('does not persist a replayable result for a domain 404', async () => {
    const key = 'phase2d-domain-failure';
    const response = await authenticatedWrite(
      'patch',
      `/api/v1/candidates/${ids.candidates.nonexistent}`,
      ids.users.zaurohAdmin,
      ids.tenants.zauroh,
      key,
    ).send({ fullName: 'Unavailable Candidate' });

    expect(response.status).toBe(404);
    await expect(
      adminPrisma.idempotencyRecord.count({ where: { key } }),
    ).resolves.toBe(0);
  });

  it('rolls back a domain insert when idempotency persistence fails', async () => {
    const key = 'phase2d-idempotency-persistence-failure';
    const input = candidateInput('AtomicRollback');

    await expect(
      executeIdempotentWrite({
        prisma: runtimePrisma,
        tenantContext: {
          ...zaurohAdminContext,
          membershipId: ids.memberships.nonexistent,
        },
        key,
        operation: IDEMPOTENCY_OPERATIONS.candidateCreate,
        fingerprintInput: { input },
        responseStatus: 201,
        parseResponse: (value) => candidateSchema.parse(value),
        execute: async (transaction) => {
          const candidate = await transaction.candidate.create({
            data: { tenantId: ids.tenants.zauroh, ...input },
          });
          return {
            id: candidate.id,
            fullName: candidate.fullName,
            email: candidate.email,
            roleAppliedFor: candidate.roleAppliedFor,
            createdAt: candidate.createdAt.toISOString(),
            updatedAt: candidate.updatedAt.toISOString(),
          };
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
    await expect(
      adminPrisma.candidate.count({ where: { email: input.email } }),
    ).resolves.toBe(0);
    await expect(
      adminPrisma.idempotencyRecord.count({ where: { key } }),
    ).resolves.toBe(0);
  });

  it('commits the mutation and replay record together on success', async () => {
    const key = 'phase2d-atomic-success';
    const response = await createCandidateRequest(key, 'AtomicSuccess');

    expect(response.status).toBe(201);
    await expect(
      adminPrisma.candidate.count({ where: { id: response.body.id } }),
    ).resolves.toBe(1);
    const record = await adminPrisma.idempotencyRecord.findFirst({
      where: { key },
    });
    expect(record).toMatchObject({
      tenantId: ids.tenants.zauroh,
      membershipId: ids.memberships.zaurohAdmin,
      operation: IDEMPOTENCY_OPERATIONS.candidateCreate,
      responseStatus: 201,
      responseBody: response.body,
    });
  });
});

import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { loadEnvironment } from '../../config/load-environment.js';
import { canonicalHash } from '../../infrastructure/crypto/canonical-hash.js';
import { AUDIT_ACTIONS } from './audit.service.js';

loadEnvironment();

const runtimePrisma = new PrismaClient();
const adminPrisma = new PrismaClient({
  datasourceUrl: process.env.DIRECT_DATABASE_URL,
});
const referenceNow = new Date('2030-12-16T12:00:00.000Z');
const jwtConfig = {
  secret: 'audit-integration-test-secret-value',
  expiresIn: '15m' as const,
};
const app = createApp({
  prisma: runtimePrisma,
  jwtConfig,
  now: () => referenceNow,
});

const ids = {
  tenant: '10000000-0000-4000-8000-000000000001',
  user: '20000000-0000-4000-8000-000000000001',
  membership: '30000000-0000-4000-8000-000000000001',
  documentCandidate: '44000000-0000-4000-8000-000000000001',
  nonexistentCandidate: '44000000-0000-4000-8000-000000000099',
  seededDocument: '50000000-0000-4000-8000-000000000001',
} as const;

function token(): string {
  return jwt.sign({}, jwtConfig.secret, {
    algorithm: 'HS256',
    expiresIn: jwtConfig.expiresIn,
    subject: ids.user,
  });
}

function authenticatedRequest(method: 'get' | 'post' | 'patch', path: string) {
  const agent = request(app);
  const pendingRequest =
    method === 'get'
      ? agent.get(path)
      : method === 'post'
        ? agent.post(path)
        : agent.patch(path);

  return pendingRequest
    .set('Authorization', `Bearer ${token()}`)
    .set('X-Tenant-Id', ids.tenant);
}

function candidateInput(name: string) {
  return {
    fullName: `${name} Candidate`,
    email: `${name.toLowerCase()}@phase3a.test`,
    roleAppliedFor: 'Audit Engineer',
  };
}

function createCandidate(key: string, name: string) {
  return authenticatedRequest('post', '/api/v1/candidates')
    .set('Idempotency-Key', key)
    .send(candidateInput(name));
}

function createDocument(key: string, expiryDate = '2035-08-20') {
  return authenticatedRequest(
    'post',
    `/api/v1/candidates/${ids.documentCandidate}/documents`,
  )
    .set('Idempotency-Key', key)
    .send({
      type: 'PROFESSIONAL_CERTIFICATION',
      issueDate: '2035-08-01',
      expiryDate,
    });
}

async function cleanFixtures(): Promise<void> {
  const candidates = await adminPrisma.candidate.findMany({
    where: {
      OR: [
        { id: ids.documentCandidate },
        { email: { endsWith: '@phase3a.test' } },
      ],
    },
    select: { id: true },
  });
  const candidateIds = candidates.map(({ id }) => id);
  const documents = await adminPrisma.complianceDocument.findMany({
    where: { candidateId: { in: candidateIds } },
    select: { id: true },
  });
  const documentIds = documents.map(({ id }) => id);

  await adminPrisma.auditEvent.deleteMany({
    where: {
      OR: [
        { recordId: { in: [...candidateIds, ...documentIds] } },
        { recordId: ids.nonexistentCandidate },
        { recordId: ids.seededDocument },
      ],
    },
  });
  await adminPrisma.idempotencyRecord.deleteMany({
    where: { key: { startsWith: 'phase3a-' } },
  });

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
    where: { id: { in: candidateIds } },
  });
}

async function createDocumentCandidate(): Promise<void> {
  await adminPrisma.candidate.create({
    data: {
      id: ids.documentCandidate,
      tenantId: ids.tenant,
      fullName: 'Phase 3A Document Candidate',
      email: 'document.candidate@phase3a.test',
      roleAppliedFor: 'Audit Fixture',
    },
  });
}

beforeAll(async () => {
  const membership = await adminPrisma.tenantMembership.count({
    where: { id: ids.membership, tenantId: ids.tenant, userId: ids.user },
  });

  if (membership !== 1) {
    throw new Error('Run pnpm db:seed before audit integration tests.');
  }
});

beforeEach(async () => {
  await cleanFixtures();
  await createDocumentCandidate();
});

afterAll(async () => {
  await cleanFixtures();
  await Promise.all([runtimePrisma.$disconnect(), adminPrisma.$disconnect()]);
});

describe('append-only audit ledger', () => {
  it('audits candidate create, update, retrieve, and returned list records', async () => {
    const created = await createCandidate(
      'phase3a-candidate-lifecycle',
      'Ledger',
    );
    const updated = await authenticatedRequest(
      'patch',
      `/api/v1/candidates/${created.body.id}`,
    )
      .set('Idempotency-Key', 'phase3a-candidate-update')
      .send({ roleAppliedFor: 'Senior Audit Engineer' });
    const retrieved = await authenticatedRequest(
      'get',
      `/api/v1/candidates/${created.body.id}`,
    );
    const listed = await authenticatedRequest(
      'get',
      `/api/v1/candidates?email=${encodeURIComponent(created.body.email)}`,
    );

    expect([
      created.status,
      updated.status,
      retrieved.status,
      listed.status,
    ]).toEqual([201, 200, 200, 200]);
    expect(listed.body.items).toEqual([updated.body]);

    const events = await adminPrisma.auditEvent.findMany({
      where: { recordId: created.body.id },
    });
    const byAction = Object.fromEntries(
      events.map((event) => [event.action, event]),
    );
    const createEvent = byAction[AUDIT_ACTIONS.candidateCreate];
    const updateEvent = byAction[AUDIT_ACTIONS.candidateUpdate];
    const readEvent = byAction[AUDIT_ACTIONS.candidateRead];
    const listEvent = byAction[AUDIT_ACTIONS.candidateListRead];

    expect(
      events.filter((event) => event.action === AUDIT_ACTIONS.candidateCreate),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.action === AUDIT_ACTIONS.candidateUpdate),
    ).toHaveLength(1);
    expect(createEvent).toMatchObject({
      tenantId: ids.tenant,
      actorUserId: ids.user,
      membershipId: ids.membership,
      recordType: 'candidate',
      beforeHash: null,
      metadata: {},
    });
    expect(updateEvent?.beforeHash).toBe(createEvent?.afterHash);
    expect(updateEvent?.afterHash).not.toBe(updateEvent?.beforeHash);
    expect(readEvent?.afterHash).toBe(updateEvent?.afterHash);
    expect(listEvent?.afterHash).toBe(updateEvent?.afterHash);
    expect(createEvent?.afterHash).toMatch(/^[0-9a-f]{64}$/);

    const storedLedger = JSON.stringify(events);
    expect(storedLedger).not.toContain(created.body.fullName);
    expect(storedLedger).not.toContain(created.body.email);
    expect(storedLedger).not.toContain(created.body.roleAppliedFor);
  });

  it('audits document create, version creation, retrieve, and returned list records', async () => {
    const created = await createDocument('phase3a-document-lifecycle');
    const versioned = await authenticatedRequest(
      'post',
      `/api/v1/documents/${created.body.id}/versions`,
    )
      .set('Idempotency-Key', 'phase3a-document-version')
      .send({ issueDate: '2035-08-02', expiryDate: '2035-08-21' });
    const retrieved = await authenticatedRequest(
      'get',
      `/api/v1/documents/${created.body.id}`,
    );
    const listed = await authenticatedRequest(
      'get',
      `/api/v1/candidates/${ids.documentCandidate}/documents?type=PROFESSIONAL_CERTIFICATION`,
    );

    expect([
      created.status,
      versioned.status,
      retrieved.status,
      listed.status,
    ]).toEqual([201, 201, 200, 200]);
    expect(listed.body.items).toEqual([versioned.body]);

    const events = await adminPrisma.auditEvent.findMany({
      where: { recordId: created.body.id },
    });
    const byAction = Object.fromEntries(
      events.map((event) => [event.action, event]),
    );
    const createEvent = byAction[AUDIT_ACTIONS.documentCreate];
    const versionEvent = byAction[AUDIT_ACTIONS.documentVersionCreate];

    expect(
      events.filter((event) => event.action === AUDIT_ACTIONS.documentCreate),
    ).toHaveLength(1);
    expect(
      events.filter(
        (event) => event.action === AUDIT_ACTIONS.documentVersionCreate,
      ),
    ).toHaveLength(1);
    expect(createEvent?.beforeHash).toBeNull();
    expect(versionEvent?.beforeHash).toBe(createEvent?.afterHash);
    expect(versionEvent?.afterHash).not.toBe(versionEvent?.beforeHash);
    expect(byAction[AUDIT_ACTIONS.documentRead]?.afterHash).toBe(
      versionEvent?.afterHash,
    );
    expect(byAction[AUDIT_ACTIONS.documentListRead]?.afterHash).toBe(
      versionEvent?.afterHash,
    );
    expect(
      events.every(
        (event) =>
          event.metadata === null ||
          Object.keys(event.metadata as object).length === 0,
      ),
    ).toBe(true);
    expect(JSON.stringify(events)).not.toContain('2035-08-21');
  });

  it('audits each document returned by the expiry query', async () => {
    const response = await authenticatedRequest(
      'get',
      '/api/v1/documents/expiring?type=RIGHT_TO_WORK&status=APPROVED',
    );

    expect(response.status).toBe(200);
    expect(response.body.items.map(({ id }: { id: string }) => id)).toContain(
      ids.seededDocument,
    );
    await expect(
      adminPrisma.auditEvent.findMany({
        where: {
          recordId: ids.seededDocument,
          action: AUDIT_ACTIONS.documentExpiryRead,
        },
      }),
    ).resolves.toHaveLength(1);
  });

  it('leaves no audit or idempotency record for a failed mutation', async () => {
    const response = await authenticatedRequest(
      'patch',
      `/api/v1/candidates/${ids.nonexistentCandidate}`,
    )
      .set('Idempotency-Key', 'phase3a-failed-update')
      .send({ fullName: 'Unavailable Candidate' });

    expect(response.status).toBe(404);
    await expect(
      adminPrisma.auditEvent.count({
        where: { recordId: ids.nonexistentCandidate },
      }),
    ).resolves.toBe(0);
    await expect(
      adminPrisma.idempotencyRecord.count({
        where: { key: 'phase3a-failed-update' },
      }),
    ).resolves.toBe(0);
  });

  it('does not duplicate a mutation event during idempotent replay', async () => {
    const first = await createCandidate('phase3a-idempotent-audit', 'Replay');
    const replay = await createCandidate('phase3a-idempotent-audit', 'Replay');

    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    await expect(
      adminPrisma.auditEvent.count({
        where: {
          recordId: first.body.id,
          action: AUDIT_ACTIONS.candidateCreate,
        },
      }),
    ).resolves.toBe(1);
  });

  it('canonicalises nested state deterministically and detects changes', () => {
    const left = canonicalHash({ z: [{ beta: 2, alpha: 1 }], a: true });
    const reordered = canonicalHash({ a: true, z: [{ alpha: 1, beta: 2 }] });
    const changed = canonicalHash({ a: true, z: [{ alpha: 1, beta: 3 }] });

    expect(reordered).toBe(left);
    expect(changed).not.toBe(left);
  });
});

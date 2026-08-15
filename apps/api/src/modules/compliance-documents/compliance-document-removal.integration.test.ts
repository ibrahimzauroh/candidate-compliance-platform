import type { TenantContext } from '@candidate-compliance/contracts';
import { PrismaClient, TenantRole } from '@prisma/client';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { loadEnvironment } from '../../config/load-environment.js';
import { canonicalHash } from '../../infrastructure/crypto/canonical-hash.js';
import { withTenantTransaction } from '../../infrastructure/database/with-tenant-transaction.js';

loadEnvironment();

const runtimePrisma = new PrismaClient();
const adminPrisma = new PrismaClient({
  datasourceUrl: process.env.DIRECT_DATABASE_URL,
});
const jwtConfig = {
  secret: 'document-removal-integration-test-secret',
  expiresIn: '15m' as const,
};
const app = createApp({
  prisma: runtimePrisma,
  jwtConfig,
  now: () => new Date('2040-08-15T12:00:00.000Z'),
});

const ids = {
  tenants: {
    primary: '10000000-0000-4000-8000-000000000001',
    other: '10000000-0000-4000-8000-000000000002',
  },
  users: {
    recruiter: '20000000-0000-4000-8000-000000000002',
    compliance: '20000000-0000-4000-8000-000000000003',
    otherAdmin: '20000000-0000-4000-8000-000000000005',
  },
  memberships: {
    compliance: '30000000-0000-4000-8000-000000000003',
  },
  candidate: '49000000-0000-4000-8000-000000000001',
  documents: {
    target: '59000000-0000-4000-8000-000000000001',
    active: '59000000-0000-4000-8000-000000000002',
  },
  versions: {
    targetV1: '69000000-0000-4000-8000-000000000001',
    targetV2: '69000000-0000-4000-8000-000000000002',
    active: '69000000-0000-4000-8000-000000000003',
  },
  verification: '99000000-0000-4000-8000-000000000001',
  outbox: 'a9000000-0000-4000-8000-000000000001',
} as const;

const documentIds = Object.values(ids.documents);
const versionIds = Object.values(ids.versions);
const primaryContext: TenantContext = {
  tenantId: ids.tenants.primary,
  userId: ids.users.compliance,
  membershipId: ids.memberships.compliance,
  role: TenantRole.COMPLIANCE_OFFICER,
};
const documentNotFoundProblem = {
  type: 'about:blank',
  title: 'Not Found',
  status: 404,
  detail: 'Compliance document was not found.',
};
const verificationNotFoundProblem = {
  type: 'about:blank',
  title: 'Not Found',
  status: 404,
  detail: 'Verification request was not found.',
};
const forbiddenProblem = {
  type: 'about:blank',
  title: 'Forbidden',
  status: 403,
  detail: 'You do not have permission to perform this operation.',
};
const idempotencyConflictProblem = {
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

function api(
  method: 'delete' | 'get' | 'post',
  path: string,
  userId: string = ids.users.compliance,
  tenantId: string = ids.tenants.primary,
) {
  const client = request(app);
  const pending =
    method === 'delete'
      ? client.delete(path)
      : method === 'get'
        ? client.get(path)
        : client.post(path);

  return pending
    .set('Authorization', `Bearer ${tokenFor(userId)}`)
    .set('X-Tenant-Id', tenantId);
}

function removeDocument(
  documentId: string,
  key: string,
  userId: string = ids.users.compliance,
  tenantId: string = ids.tenants.primary,
) {
  return api('delete', `/api/v1/documents/${documentId}`, userId, tenantId).set(
    'Idempotency-Key',
    key,
  );
}

async function cleanFixtures(): Promise<void> {
  await adminPrisma.outboxEvent.deleteMany({
    where: { verificationRequestId: ids.verification },
  });
  await adminPrisma.auditEvent.deleteMany({
    where: {
      recordId: { in: [...documentIds, ids.verification] },
    },
  });
  await adminPrisma.idempotencyRecord.deleteMany({
    where: { key: { startsWith: 'phase2e-document-' } },
  });
  await adminPrisma.verificationRequest.deleteMany({
    where: { documentId: { in: documentIds } },
  });
  await adminPrisma.complianceDocument.updateMany({
    where: { id: { in: documentIds } },
    data: { currentVersionId: null },
  });
  await adminPrisma.complianceDocumentVersion.deleteMany({
    where: { id: { in: versionIds } },
  });
  await adminPrisma.complianceDocument.deleteMany({
    where: { id: { in: documentIds } },
  });
  await adminPrisma.candidate.deleteMany({ where: { id: ids.candidate } });
}

async function createFixtures(): Promise<void> {
  const createdAt = new Date('2026-08-15T09:00:00.000Z');
  await adminPrisma.$transaction(async (transaction) => {
    await transaction.candidate.create({
      data: {
        id: ids.candidate,
        tenantId: ids.tenants.primary,
        fullName: 'Document Removal Candidate',
        email: 'document@phase2e-document.test',
        roleAppliedFor: 'Phase Two E Document Fixture',
        createdAt,
      },
    });
    for (const documentId of documentIds) {
      await transaction.complianceDocument.create({
        data: {
          id: documentId,
          tenantId: ids.tenants.primary,
          candidateId: ids.candidate,
          type: 'RIGHT_TO_WORK',
          createdAt,
        },
      });
    }
    await transaction.complianceDocumentVersion.createMany({
      data: [
        {
          id: ids.versions.targetV1,
          tenantId: ids.tenants.primary,
          documentId: ids.documents.target,
          versionNumber: 1,
          issueDate: new Date('2025-08-01T00:00:00.000Z'),
          expiryDate: new Date('2040-08-20T00:00:00.000Z'),
          status: 'APPROVED',
          createdBy: ids.memberships.compliance,
          createdAt,
        },
        {
          id: ids.versions.targetV2,
          tenantId: ids.tenants.primary,
          documentId: ids.documents.target,
          versionNumber: 2,
          issueDate: new Date('2026-08-01T00:00:00.000Z'),
          expiryDate: new Date('2040-08-20T00:00:00.000Z'),
          status: 'APPROVED',
          supersedesVersionId: ids.versions.targetV1,
          createdBy: ids.memberships.compliance,
          createdAt: new Date('2026-08-15T10:00:00.000Z'),
        },
        {
          id: ids.versions.active,
          tenantId: ids.tenants.primary,
          documentId: ids.documents.active,
          versionNumber: 1,
          issueDate: new Date('2025-08-01T00:00:00.000Z'),
          expiryDate: new Date('2040-08-25T00:00:00.000Z'),
          status: 'APPROVED',
          createdBy: ids.memberships.compliance,
          createdAt,
        },
      ],
    });
    await transaction.complianceDocument.update({
      where: { id: ids.documents.target },
      data: { currentVersionId: ids.versions.targetV2 },
    });
    await transaction.complianceDocument.update({
      where: { id: ids.documents.active },
      data: { currentVersionId: ids.versions.active },
    });
    await transaction.verificationRequest.create({
      data: {
        id: ids.verification,
        tenantId: ids.tenants.primary,
        documentId: ids.documents.target,
        documentVersionId: ids.versions.targetV2,
        requestedByUserId: ids.users.compliance,
        requestedByMembershipId: ids.memberships.compliance,
      },
    });
    await transaction.outboxEvent.create({
      data: {
        id: ids.outbox,
        tenantId: ids.tenants.primary,
        verificationRequestId: ids.verification,
        type: 'RIGHT_TO_WORK_VERIFICATION_REQUESTED',
      },
    });
  });
}

beforeAll(async () => {
  const membership = await adminPrisma.tenantMembership.count({
    where: { id: ids.memberships.compliance },
  });
  if (membership !== 1) {
    throw new Error('Run pnpm db:seed before document removal tests.');
  }
  await cleanFixtures();
});

beforeEach(async () => {
  await cleanFixtures();
  await createFixtures();
});

afterAll(async () => {
  await cleanFixtures();
  await Promise.all([runtimePrisma.$disconnect(), adminPrisma.$disconnect()]);
});

describe('DELETE /api/v1/documents/:documentId retention semantics', () => {
  it('retains immutable history and fails closed across the document lifecycle', async () => {
    const documentBefore =
      await adminPrisma.complianceDocument.findUniqueOrThrow({
        where: { id: ids.documents.target },
        include: { currentVersion: true },
      });
    const versionsBefore = await adminPrisma.complianceDocumentVersion.findMany(
      {
        where: { documentId: ids.documents.target },
        orderBy: { versionNumber: 'asc' },
      },
    );
    const response = await removeDocument(
      ids.documents.target,
      'phase2e-document-retain',
    );

    expect(response.status).toBe(204);
    expect(response.text).toBe('');

    const stored = await adminPrisma.complianceDocument.findUniqueOrThrow({
      where: { id: ids.documents.target },
      include: { currentVersion: true },
    });
    const versionsAfter = await adminPrisma.complianceDocumentVersion.findMany({
      where: { documentId: ids.documents.target },
      orderBy: { versionNumber: 'asc' },
    });
    expect(stored.removedAt).not.toBeNull();
    expect(stored.currentVersionId).toBe(ids.versions.targetV2);
    expect(versionsAfter).toEqual(versionsBefore);
    await expect(
      adminPrisma.verificationRequest.count({
        where: { id: ids.verification },
      }),
    ).resolves.toBe(1);
    await expect(
      adminPrisma.outboxEvent.count({ where: { id: ids.outbox } }),
    ).resolves.toBe(1);

    const currentVersion = documentBefore.currentVersion;
    if (!currentVersion) {
      throw new Error('Document fixture must have a current version.');
    }
    const versionState = {
      id: currentVersion.id,
      versionNumber: currentVersion.versionNumber,
      issueDate: currentVersion.issueDate?.toISOString().slice(0, 10) ?? null,
      expiryDate: currentVersion.expiryDate?.toISOString().slice(0, 10) ?? null,
      status: currentVersion.status,
      createdAt: currentVersion.createdAt.toISOString(),
    };
    const event = await adminPrisma.auditEvent.findFirstOrThrow({
      where: { action: 'document:remove', recordId: ids.documents.target },
    });
    expect(event.beforeHash).toBe(
      canonicalHash({
        id: documentBefore.id,
        candidateId: documentBefore.candidateId,
        type: documentBefore.type,
        currentVersion: versionState,
        createdAt: documentBefore.createdAt.toISOString(),
        updatedAt: documentBefore.updatedAt.toISOString(),
        removedAt: null,
      }),
    );
    expect(event.afterHash).toBe(
      canonicalHash({
        id: stored.id,
        candidateId: stored.candidateId,
        type: stored.type,
        currentVersion: versionState,
        createdAt: stored.createdAt.toISOString(),
        updatedAt: stored.updatedAt.toISOString(),
        removedAt: stored.removedAt?.toISOString() ?? null,
      }),
    );

    const get = await api('get', `/api/v1/documents/${ids.documents.target}`);
    const list = await api(
      'get',
      `/api/v1/candidates/${ids.candidate}/documents?page=1&pageSize=1`,
    );
    const expiring = await api(
      'get',
      '/api/v1/documents/expiring?page=1&pageSize=100',
    );
    const version = await api(
      'post',
      `/api/v1/documents/${ids.documents.target}/versions`,
      ids.users.recruiter,
    )
      .set('Idempotency-Key', 'phase2e-document-version')
      .send({});
    const approval = await api(
      'post',
      `/api/v1/documents/${ids.documents.target}/approve`,
    )
      .set('Idempotency-Key', 'phase2e-document-approve')
      .send({});
    const correction = await api(
      'post',
      `/api/v1/documents/${ids.documents.target}/corrections`,
    )
      .set('Idempotency-Key', 'phase2e-document-correct')
      .send({ issueDate: '2026-08-01', expiryDate: '2027-08-20' });
    const verificationCreate = await api(
      'post',
      `/api/v1/documents/${ids.documents.target}/verifications`,
      ids.users.recruiter,
    )
      .set('Idempotency-Key', 'phase2e-document-verification')
      .send({});
    const verificationGet = await api(
      'get',
      `/api/v1/verifications/${ids.verification}`,
      ids.users.recruiter,
    );

    expect(get.body).toEqual(documentNotFoundProblem);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].id).toBe(ids.documents.active);
    expect(expiring.status).toBe(200);
    expect(
      expiring.body.items.map((item: { id: string }) => item.id),
    ).not.toContain(ids.documents.target);
    expect(version.body).toEqual(documentNotFoundProblem);
    expect(approval.body).toEqual(documentNotFoundProblem);
    expect(correction.body).toEqual(documentNotFoundProblem);
    expect(verificationCreate.body).toEqual(documentNotFoundProblem);
    expect(verificationGet.body).toEqual(verificationNotFoundProblem);
  });

  it('replays one concurrent removal without duplicate audit or idempotency rows', async () => {
    const key = 'phase2e-document-concurrent';
    const responses = await Promise.all([
      removeDocument(ids.documents.target, key),
      removeDocument(ids.documents.target, key),
    ]);

    expect(responses.map(({ status }) => status)).toEqual([204, 204]);
    await expect(
      adminPrisma.auditEvent.count({
        where: { action: 'document:remove', recordId: ids.documents.target },
      }),
    ).resolves.toBe(1);
    await expect(
      adminPrisma.idempotencyRecord.count({
        where: { operation: 'document:remove', key },
      }),
    ).resolves.toBe(1);
  });

  it('returns conflict for different input under the same key', async () => {
    const key = 'phase2e-document-conflict';
    expect((await removeDocument(ids.documents.target, key)).status).toBe(204);
    const conflict = await removeDocument(ids.documents.active, key);

    expect(conflict.status).toBe(409);
    expect(conflict.body).toEqual(idempotencyConflictProblem);
    await expect(
      adminPrisma.complianceDocument.findUniqueOrThrow({
        where: { id: ids.documents.active },
      }),
    ).resolves.toMatchObject({ removedAt: null });
  });

  it('does not let an older successful lifecycle key re-expose an inactive document', async () => {
    const approvalKey = 'phase2e-document-old-approval';
    const approval = await api(
      'post',
      `/api/v1/documents/${ids.documents.target}/approve`,
    )
      .set('Idempotency-Key', approvalKey)
      .send({});
    expect(approval.status).toBe(200);
    expect(
      (
        await removeDocument(
          ids.documents.target,
          'phase2e-document-after-approval',
        )
      ).status,
    ).toBe(204);

    const replay = await api(
      'post',
      `/api/v1/documents/${ids.documents.target}/approve`,
    )
      .set('Idempotency-Key', approvalKey)
      .send({});
    expect(replay.status).toBe(404);
    expect(replay.body).toEqual(documentNotFoundProblem);
  });

  it('uses the compliance removal permission and neutral cross-tenant 404', async () => {
    const denied = await removeDocument(
      ids.documents.target,
      'phase2e-document-denied',
      ids.users.recruiter,
    );
    const crossTenant = await removeDocument(
      ids.documents.target,
      'phase2e-document-cross-tenant',
      ids.users.otherAdmin,
      ids.tenants.other,
    );

    expect(denied.status).toBe(403);
    expect(denied.body).toEqual(forbiddenProblem);
    expect(crossTenant.status).toBe(404);
    expect(crossTenant.body).toEqual(documentNotFoundProblem);
    await expect(
      adminPrisma.idempotencyRecord.count({
        where: {
          key: {
            in: ['phase2e-document-denied', 'phase2e-document-cross-tenant'],
          },
        },
      }),
    ).resolves.toBe(0);
  });

  it('validates authentication, identifiers, keys, and inactive resources', async () => {
    const unauthenticated = await request(app)
      .delete(`/api/v1/documents/${ids.documents.target}`)
      .set('X-Tenant-Id', ids.tenants.primary)
      .set('Idempotency-Key', 'phase2e-document-unauthenticated');
    const malformed = await removeDocument(
      'not-a-uuid',
      'phase2e-document-malformed',
    );
    const missingKey = await api(
      'delete',
      `/api/v1/documents/${ids.documents.target}`,
    );

    expect(unauthenticated.status).toBe(401);
    expect(malformed.status).toBe(400);
    expect(missingKey.status).toBe(400);

    expect(
      (await removeDocument(ids.documents.target, 'phase2e-document-first-key'))
        .status,
    ).toBe(204);
    const inactive = await removeDocument(
      ids.documents.target,
      'phase2e-document-second-key',
    );
    expect(inactive.status).toBe(404);
    expect(inactive.body).toEqual(documentNotFoundProblem);
    await expect(
      adminPrisma.idempotencyRecord.count({
        where: { key: 'phase2e-document-second-key' },
      }),
    ).resolves.toBe(0);
  });

  it('does not grant runtime restoration or physical deletion', async () => {
    expect(
      (await removeDocument(ids.documents.target, 'phase2e-document-one-way'))
        .status,
    ).toBe(204);
    await expect(
      withTenantTransaction(runtimePrisma, primaryContext, (transaction) =>
        transaction.complianceDocument.update({
          where: { id: ids.documents.target },
          data: { removedAt: null },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenantTransaction(runtimePrisma, primaryContext, (transaction) =>
        transaction.complianceDocument.delete({
          where: { id: ids.documents.target },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      adminPrisma.complianceDocument.findUnique({
        where: { id: ids.documents.target },
      }),
    ).resolves.not.toBeNull();
  });
});

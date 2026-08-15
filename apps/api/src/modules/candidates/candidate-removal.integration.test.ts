import { canonicalHash } from '../../infrastructure/crypto/canonical-hash.js';
import { withTenantTransaction } from '../../infrastructure/database/with-tenant-transaction.js';
import type { TenantContext } from '@candidate-compliance/contracts';
import { PrismaClient, TenantRole } from '@prisma/client';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { loadEnvironment } from '../../config/load-environment.js';

loadEnvironment();

const runtimePrisma = new PrismaClient();
const adminPrisma = new PrismaClient({
  datasourceUrl: process.env.DIRECT_DATABASE_URL,
});
const jwtConfig = {
  secret: 'candidate-removal-integration-test-secret',
  expiresIn: '15m' as const,
};
const app = createApp({ prisma: runtimePrisma, jwtConfig });

const ids = {
  tenants: {
    primary: '10000000-0000-4000-8000-000000000001',
    other: '10000000-0000-4000-8000-000000000002',
  },
  users: {
    admin: '20000000-0000-4000-8000-000000000001',
    recruiter: '20000000-0000-4000-8000-000000000002',
    otherAdmin: '20000000-0000-4000-8000-000000000005',
  },
  memberships: {
    admin: '30000000-0000-4000-8000-000000000001',
  },
  candidates: {
    target: '48000000-0000-4000-8000-000000000001',
    activeOne: '48000000-0000-4000-8000-000000000002',
    activeTwo: '48000000-0000-4000-8000-000000000003',
  },
  document: '58000000-0000-4000-8000-000000000001',
  version: '68000000-0000-4000-8000-000000000001',
  extraction: '78000000-0000-4000-8000-000000000001',
  profile: '88000000-0000-4000-8000-000000000001',
  verification: '98000000-0000-4000-8000-000000000001',
  outbox: 'a8000000-0000-4000-8000-000000000001',
} as const;

const targetIds = Object.values(ids.candidates);
const primaryContext: TenantContext = {
  tenantId: ids.tenants.primary,
  userId: ids.users.admin,
  membershipId: ids.memberships.admin,
  role: TenantRole.ADMIN,
};
const candidateNotFoundProblem = {
  type: 'about:blank',
  title: 'Not Found',
  status: 404,
  detail: 'Candidate was not found.',
};
const documentNotFoundProblem = {
  type: 'about:blank',
  title: 'Not Found',
  status: 404,
  detail: 'Compliance document was not found.',
};
const extractionNotFoundProblem = {
  type: 'about:blank',
  title: 'Not Found',
  status: 404,
  detail: 'CV extraction was not found.',
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
  method: 'delete' | 'get' | 'patch' | 'post',
  path: string,
  userId: string = ids.users.admin,
  tenantId: string = ids.tenants.primary,
) {
  const client = request(app);
  const pending =
    method === 'delete'
      ? client.delete(path)
      : method === 'get'
        ? client.get(path)
        : method === 'patch'
          ? client.patch(path)
          : client.post(path);

  return pending
    .set('Authorization', `Bearer ${tokenFor(userId)}`)
    .set('X-Tenant-Id', tenantId);
}

function removeCandidate(
  candidateId: string,
  key: string,
  userId: string = ids.users.admin,
  tenantId: string = ids.tenants.primary,
) {
  return api(
    'delete',
    `/api/v1/candidates/${candidateId}`,
    userId,
    tenantId,
  ).set('Idempotency-Key', key);
}

async function cleanFixtures(): Promise<void> {
  await adminPrisma.outboxEvent.deleteMany({
    where: { verificationRequestId: ids.verification },
  });
  await adminPrisma.auditEvent.deleteMany({
    where: {
      recordId: {
        in: [...targetIds, ids.document, ids.extraction, ids.verification],
      },
    },
  });
  await adminPrisma.idempotencyRecord.deleteMany({
    where: { key: { startsWith: 'phase2e-candidate-' } },
  });
  await adminPrisma.candidateProfile.deleteMany({
    where: { candidateId: { in: targetIds } },
  });
  await adminPrisma.cvExtraction.deleteMany({
    where: { candidateId: { in: targetIds } },
  });
  await adminPrisma.verificationRequest.deleteMany({
    where: { documentId: ids.document },
  });
  await adminPrisma.complianceDocument.updateMany({
    where: { id: ids.document },
    data: { currentVersionId: null },
  });
  await adminPrisma.complianceDocumentVersion.deleteMany({
    where: { documentId: ids.document },
  });
  await adminPrisma.complianceDocument.deleteMany({
    where: { id: ids.document },
  });
  await adminPrisma.candidate.deleteMany({
    where: { id: { in: targetIds } },
  });
}

async function createFixtures(): Promise<void> {
  const createdAt = new Date('2026-08-15T09:00:00.000Z');
  const approvedAt = new Date('2026-08-15T09:10:00.000Z');

  await adminPrisma.$transaction(async (transaction) => {
    await transaction.candidate.createMany({
      data: [
        {
          id: ids.candidates.target,
          tenantId: ids.tenants.primary,
          fullName: 'Removal Target',
          email: 'target@phase2e-candidate.test',
          roleAppliedFor: 'Phase Two E Retention Fixture',
          createdAt,
        },
        {
          id: ids.candidates.activeOne,
          tenantId: ids.tenants.primary,
          fullName: 'Active One',
          email: 'active-one@phase2e-candidate.test',
          roleAppliedFor: 'Phase Two E Retention Fixture',
          createdAt: new Date('2026-08-15T08:00:00.000Z'),
        },
        {
          id: ids.candidates.activeTwo,
          tenantId: ids.tenants.primary,
          fullName: 'Active Two',
          email: 'active-two@phase2e-candidate.test',
          roleAppliedFor: 'Phase Two E Retention Fixture',
          createdAt: new Date('2026-08-15T07:00:00.000Z'),
        },
      ],
    });
    await transaction.complianceDocument.create({
      data: {
        id: ids.document,
        tenantId: ids.tenants.primary,
        candidateId: ids.candidates.target,
        type: 'RIGHT_TO_WORK',
        createdAt,
      },
    });
    await transaction.complianceDocumentVersion.create({
      data: {
        id: ids.version,
        tenantId: ids.tenants.primary,
        documentId: ids.document,
        versionNumber: 1,
        issueDate: new Date('2026-08-01T00:00:00.000Z'),
        expiryDate: new Date('2030-08-01T00:00:00.000Z'),
        status: 'APPROVED',
        createdBy: ids.memberships.admin,
        createdAt: approvedAt,
      },
    });
    await transaction.complianceDocument.update({
      where: { id: ids.document },
      data: { currentVersionId: ids.version },
    });
    await transaction.verificationRequest.create({
      data: {
        id: ids.verification,
        tenantId: ids.tenants.primary,
        documentId: ids.document,
        documentVersionId: ids.version,
        requestedByUserId: ids.users.admin,
        requestedByMembershipId: ids.memberships.admin,
        status: 'VERIFIED',
        attemptCount: 1,
        requestedAt: approvedAt,
        startedAt: approvedAt,
        completedAt: approvedAt,
      },
    });
    await transaction.outboxEvent.create({
      data: {
        id: ids.outbox,
        tenantId: ids.tenants.primary,
        verificationRequestId: ids.verification,
        type: 'RIGHT_TO_WORK_VERIFICATION_REQUESTED',
        processedAt: approvedAt,
      },
    });
    await transaction.cvExtraction.create({
      data: {
        id: ids.extraction,
        tenantId: ids.tenants.primary,
        candidateId: ids.candidates.target,
        requestedByUserId: ids.users.admin,
        requestedByMembershipId: ids.memberships.admin,
        provider: 'local-mock',
        model: 'deterministic-v1',
        proposedOutput: {
          fullName: 'Removal Target',
          skills: ['TypeScript'],
          yearsOfExperience: 5,
          certifications: [],
        },
        confirmedOutput: {
          fullName: 'Removal Target',
          skills: ['TypeScript'],
          yearsOfExperience: 5,
          certifications: [],
        },
        status: 'ACCEPTED',
        reviewedByUserId: ids.users.admin,
        reviewedByMembershipId: ids.memberships.admin,
        decidedAt: approvedAt,
      },
    });
    await transaction.candidateProfile.create({
      data: {
        id: ids.profile,
        tenantId: ids.tenants.primary,
        candidateId: ids.candidates.target,
        sourceExtractionId: ids.extraction,
        fullName: 'Removal Target',
        skills: ['TypeScript'],
        yearsOfExperience: 5,
        certifications: [],
      },
    });
  });
}

beforeAll(async () => {
  const requiredMemberships = await adminPrisma.tenantMembership.count({
    where: {
      id: { in: [ids.memberships.admin] },
    },
  });
  if (requiredMemberships !== 1) {
    throw new Error('Run pnpm db:seed before Candidate removal tests.');
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

describe('DELETE /api/v1/candidates/:candidateId retention semantics', () => {
  it('retains the aggregate evidence while every normal entry point fails closed', async () => {
    const before = await adminPrisma.candidate.findUniqueOrThrow({
      where: { id: ids.candidates.target },
    });
    const versionBefore =
      await adminPrisma.complianceDocumentVersion.findUniqueOrThrow({
        where: { id: ids.version },
      });
    const response = await removeCandidate(
      ids.candidates.target,
      'phase2e-candidate-retain',
    );

    expect(response.status).toBe(204);
    expect(response.text).toBe('');

    const stored = await adminPrisma.candidate.findUniqueOrThrow({
      where: { id: ids.candidates.target },
    });
    expect(stored.removedAt).not.toBeNull();
    await expect(
      adminPrisma.complianceDocumentVersion.findUniqueOrThrow({
        where: { id: ids.version },
      }),
    ).resolves.toEqual(versionBefore);
    await expect(
      adminPrisma.complianceDocument.count({ where: { id: ids.document } }),
    ).resolves.toBe(1);
    await expect(
      adminPrisma.verificationRequest.count({
        where: { id: ids.verification },
      }),
    ).resolves.toBe(1);
    await expect(
      adminPrisma.outboxEvent.count({ where: { id: ids.outbox } }),
    ).resolves.toBe(1);
    await expect(
      adminPrisma.cvExtraction.count({ where: { id: ids.extraction } }),
    ).resolves.toBe(1);
    await expect(
      adminPrisma.candidateProfile.count({ where: { id: ids.profile } }),
    ).resolves.toBe(1);

    const event = await adminPrisma.auditEvent.findFirstOrThrow({
      where: { action: 'candidate:remove', recordId: ids.candidates.target },
    });
    expect(event.beforeHash).toBe(
      canonicalHash({
        id: before.id,
        fullName: before.fullName,
        email: before.email,
        roleAppliedFor: before.roleAppliedFor,
        createdAt: before.createdAt.toISOString(),
        updatedAt: before.updatedAt.toISOString(),
        removedAt: null,
      }),
    );
    expect(event.afterHash).toBe(
      canonicalHash({
        id: stored.id,
        fullName: stored.fullName,
        email: stored.email,
        roleAppliedFor: stored.roleAppliedFor,
        createdAt: stored.createdAt.toISOString(),
        updatedAt: stored.updatedAt.toISOString(),
        removedAt: stored.removedAt?.toISOString() ?? null,
      }),
    );

    const candidateGet = await api(
      'get',
      `/api/v1/candidates/${ids.candidates.target}`,
    );
    const candidateUpdate = await api(
      'patch',
      `/api/v1/candidates/${ids.candidates.target}`,
    )
      .set('Idempotency-Key', 'phase2e-candidate-update')
      .send({ fullName: 'Must Not Change' });
    const documentCreate = await api(
      'post',
      `/api/v1/candidates/${ids.candidates.target}/documents`,
    )
      .set('Idempotency-Key', 'phase2e-candidate-document')
      .send({ type: 'RIGHT_TO_WORK' });
    const documentList = await api(
      'get',
      `/api/v1/candidates/${ids.candidates.target}/documents`,
    );
    const documentGet = await api('get', `/api/v1/documents/${ids.document}`);
    const extractionCreate = await api(
      'post',
      `/api/v1/candidates/${ids.candidates.target}/cv-extractions`,
      ids.users.recruiter,
    )
      .set('Idempotency-Key', 'phase2e-candidate-extract')
      .set('Content-Type', 'text/plain')
      .send('Name: Hidden Candidate');
    const extractionGet = await api(
      'get',
      `/api/v1/cv-extractions/${ids.extraction}`,
      ids.users.recruiter,
    );
    const extractionConfirm = await api(
      'post',
      `/api/v1/cv-extractions/${ids.extraction}/confirm`,
      ids.users.recruiter,
    )
      .set('Idempotency-Key', 'phase2e-candidate-confirm')
      .send({
        fullName: 'Hidden',
        skills: [],
        yearsOfExperience: 0,
        certifications: [],
      });
    const extractionReject = await api(
      'post',
      `/api/v1/cv-extractions/${ids.extraction}/reject`,
      ids.users.admin,
    )
      .set('Idempotency-Key', 'phase2e-candidate-reject')
      .send({});
    const verificationGet = await api(
      'get',
      `/api/v1/verifications/${ids.verification}`,
      ids.users.recruiter,
    );
    const verificationCreate = await api(
      'post',
      `/api/v1/documents/${ids.document}/verifications`,
      ids.users.recruiter,
    )
      .set('Idempotency-Key', 'phase2e-candidate-verification')
      .send({});

    expect(candidateGet.body).toEqual(candidateNotFoundProblem);
    expect(candidateUpdate.body).toEqual(candidateNotFoundProblem);
    expect(documentCreate.body).toEqual(candidateNotFoundProblem);
    expect(documentList.body).toEqual(candidateNotFoundProblem);
    expect(documentGet.body).toEqual(documentNotFoundProblem);
    expect(extractionCreate.body).toEqual(candidateNotFoundProblem);
    expect(extractionGet.body).toEqual(extractionNotFoundProblem);
    expect(extractionConfirm.body).toEqual(extractionNotFoundProblem);
    expect(extractionReject.body).toEqual(extractionNotFoundProblem);
    expect(verificationGet.body).toEqual(verificationNotFoundProblem);
    expect(verificationCreate.body).toEqual(documentNotFoundProblem);

    const list = await api('get', '/api/v1/candidates?page=1&pageSize=2');
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(2);
    expect(
      list.body.items.map((candidate: { id: string }) => candidate.id),
    ).not.toContain(ids.candidates.target);
  });

  it('replays one concurrent removal without duplicating audit state', async () => {
    const key = 'phase2e-candidate-concurrent';
    const responses = await Promise.all([
      removeCandidate(ids.candidates.target, key),
      removeCandidate(ids.candidates.target, key),
    ]);

    expect(responses.map(({ status }) => status)).toEqual([204, 204]);
    await expect(
      adminPrisma.auditEvent.count({
        where: { action: 'candidate:remove', recordId: ids.candidates.target },
      }),
    ).resolves.toBe(1);
    await expect(
      adminPrisma.idempotencyRecord.count({
        where: { operation: 'candidate:remove', key },
      }),
    ).resolves.toBe(1);
  });

  it('returns conflict for different input under the same key', async () => {
    const key = 'phase2e-candidate-conflict';
    expect((await removeCandidate(ids.candidates.target, key)).status).toBe(
      204,
    );
    const conflict = await removeCandidate(ids.candidates.activeOne, key);

    expect(conflict.status).toBe(409);
    expect(conflict.body).toEqual(idempotencyConflictProblem);
    await expect(
      adminPrisma.candidate.findUniqueOrThrow({
        where: { id: ids.candidates.activeOne },
      }),
    ).resolves.toMatchObject({ removedAt: null });
  });

  it('does not let an older successful write key re-expose an inactive Candidate', async () => {
    const updateKey = 'phase2e-candidate-old-update';
    const updated = await api(
      'patch',
      `/api/v1/candidates/${ids.candidates.target}`,
    )
      .set('Idempotency-Key', updateKey)
      .send({ roleAppliedFor: 'Updated Before Removal' });
    expect(updated.status).toBe(200);
    expect(
      (
        await removeCandidate(
          ids.candidates.target,
          'phase2e-candidate-after-update',
        )
      ).status,
    ).toBe(204);

    const replay = await api(
      'patch',
      `/api/v1/candidates/${ids.candidates.target}`,
    )
      .set('Idempotency-Key', updateKey)
      .send({ roleAppliedFor: 'Updated Before Removal' });
    expect(replay.status).toBe(404);
    expect(replay.body).toEqual(candidateNotFoundProblem);
  });

  it('uses explicit permission and tenant-neutral not-found behaviour', async () => {
    const denied = await removeCandidate(
      ids.candidates.target,
      'phase2e-candidate-denied',
      ids.users.recruiter,
    );
    const crossTenant = await removeCandidate(
      ids.candidates.target,
      'phase2e-candidate-cross-tenant',
      ids.users.otherAdmin,
      ids.tenants.other,
    );

    expect(denied.status).toBe(403);
    expect(denied.body).toEqual(forbiddenProblem);
    expect(crossTenant.status).toBe(404);
    expect(crossTenant.body).toEqual(candidateNotFoundProblem);
    await expect(
      adminPrisma.idempotencyRecord.count({
        where: {
          key: {
            in: ['phase2e-candidate-denied', 'phase2e-candidate-cross-tenant'],
          },
        },
      }),
    ).resolves.toBe(0);
  });

  it('validates authentication, identifiers, keys, and inactive resources', async () => {
    const unauthenticated = await request(app)
      .delete(`/api/v1/candidates/${ids.candidates.target}`)
      .set('X-Tenant-Id', ids.tenants.primary)
      .set('Idempotency-Key', 'phase2e-candidate-unauthenticated');
    const malformed = await removeCandidate(
      'not-a-uuid',
      'phase2e-candidate-malformed',
    );
    const missingKey = await api(
      'delete',
      `/api/v1/candidates/${ids.candidates.target}`,
    );

    expect(unauthenticated.status).toBe(401);
    expect(malformed.status).toBe(400);
    expect(missingKey.status).toBe(400);

    expect(
      (
        await removeCandidate(
          ids.candidates.target,
          'phase2e-candidate-first-key',
        )
      ).status,
    ).toBe(204);
    const inactive = await removeCandidate(
      ids.candidates.target,
      'phase2e-candidate-second-key',
    );
    expect(inactive.status).toBe(404);
    expect(inactive.body).toEqual(candidateNotFoundProblem);
    await expect(
      adminPrisma.idempotencyRecord.count({
        where: { key: 'phase2e-candidate-second-key' },
      }),
    ).resolves.toBe(0);
  });

  it('does not grant runtime restoration or physical deletion', async () => {
    expect(
      (
        await removeCandidate(
          ids.candidates.target,
          'phase2e-candidate-one-way',
        )
      ).status,
    ).toBe(204);
    await expect(
      withTenantTransaction(runtimePrisma, primaryContext, (transaction) =>
        transaction.candidate.update({
          where: { id: ids.candidates.target },
          data: { removedAt: null },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenantTransaction(runtimePrisma, primaryContext, (transaction) =>
        transaction.candidate.delete({ where: { id: ids.candidates.target } }),
      ),
    ).rejects.toThrow();
    await expect(
      adminPrisma.candidate.findUnique({
        where: { id: ids.candidates.target },
      }),
    ).resolves.not.toBeNull();
  });
});

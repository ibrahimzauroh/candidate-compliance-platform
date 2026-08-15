import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { loadEnvironment } from '../../config/load-environment.js';
import { AUDIT_ACTIONS } from '../audit/audit.service.js';
import { DeterministicLocalRightToWorkVerifier } from './right-to-work-verifier.js';
import { processNextVerificationEvent } from './verification.processor.js';

loadEnvironment();

const runtimePrisma = new PrismaClient();
const adminPrisma = new PrismaClient({
  datasourceUrl: process.env.DIRECT_DATABASE_URL,
});
const jwtConfig = {
  secret: 'verification-integration-test-secret',
  expiresIn: '15m' as const,
};
const app = createApp({ prisma: runtimePrisma, jwtConfig });

const ids = {
  tenants: {
    zauroh: '10000000-0000-4000-8000-000000000001',
    khaleel: '10000000-0000-4000-8000-000000000002',
  },
  users: {
    recruiter: '20000000-0000-4000-8000-000000000002',
    viewer: '20000000-0000-4000-8000-000000000004',
  },
  memberships: {
    recruiter: '30000000-0000-4000-8000-000000000002',
  },
  candidate: '46000000-0000-4000-8000-000000000001',
  documents: {
    success: '56000000-0000-4000-8000-000000000001',
    failure: '56000000-0000-4000-8000-000000000002',
    retry: '56000000-0000-4000-8000-000000000003',
    concurrent: '56000000-0000-4000-8000-000000000004',
    second: '56000000-0000-4000-8000-000000000005',
    ineligible: '56000000-0000-4000-8000-000000000006',
  },
  versions: {
    success: '66000000-0000-4000-8000-000000000001',
    failure: '66000000-0000-4000-8000-000000000002',
    retry: '66000000-0000-4000-8000-000000000003',
    concurrent: '66000000-0000-4000-8000-000000000004',
    second: '66000000-0000-4000-8000-000000000005',
    ineligible: '66000000-0000-4000-8000-000000000006',
  },
} as const;

const documentIds = Object.values(ids.documents);
const versionIds = Object.values(ids.versions);

function countFixtureRequests() {
  return adminPrisma.verificationRequest.count({
    where: { documentId: { in: documentIds } },
  });
}

function countFixtureOutboxEvents() {
  return adminPrisma.outboxEvent.count({
    where: {
      verificationRequest: { documentId: { in: documentIds } },
    },
  });
}

const forbiddenProblem = {
  type: 'about:blank',
  title: 'Forbidden',
  status: 403,
  detail: 'You do not have permission to perform this operation.',
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
const eligibilityProblem = {
  type: 'about:blank',
  title: 'Conflict',
  status: 409,
  detail:
    'Only an approved current Right-to-Work document version can be submitted for verification.',
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

function submitVerification(
  documentId: string,
  key: string,
  userId: string = ids.users.recruiter,
  tenantId: string = ids.tenants.zauroh,
) {
  return request(app)
    .post(`/api/v1/documents/${documentId}/verifications`)
    .set('Authorization', `Bearer ${tokenFor(userId)}`)
    .set('X-Tenant-Id', tenantId)
    .set('Idempotency-Key', key)
    .send({});
}

function readVerification(
  verificationRequestId: string,
  userId: string = ids.users.viewer,
  tenantId: string = ids.tenants.zauroh,
) {
  return request(app)
    .get(`/api/v1/verifications/${verificationRequestId}`)
    .set('Authorization', `Bearer ${tokenFor(userId)}`)
    .set('X-Tenant-Id', tenantId);
}

async function cleanFixtures(): Promise<void> {
  const requests = await adminPrisma.verificationRequest.findMany({
    where: { documentId: { in: documentIds } },
    select: { id: true },
  });
  const requestIds = requests.map(({ id }) => id);

  await adminPrisma.outboxEvent.deleteMany({
    where: { verificationRequestId: { in: requestIds } },
  });
  await adminPrisma.auditEvent.deleteMany({
    where: {
      OR: [{ recordId: { in: requestIds } }, { recordId: { in: documentIds } }],
    },
  });
  await adminPrisma.idempotencyRecord.deleteMany({
    where: { key: { startsWith: 'phase4-' } },
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
  await adminPrisma.candidate.deleteMany({
    where: { id: ids.candidate },
  });
}

async function createFixtures(): Promise<void> {
  await adminPrisma.candidate.create({
    data: {
      id: ids.candidate,
      tenantId: ids.tenants.zauroh,
      fullName: 'Phase Four Candidate',
      email: 'verification.workflow@phase4.test',
      roleAppliedFor: 'Right To Work Reviewer',
    },
  });

  const fixtures = [
    {
      documentId: ids.documents.success,
      versionId: ids.versions.success,
      type: 'RIGHT_TO_WORK' as const,
      status: 'APPROVED' as const,
      expiryDate: new Date('2035-08-01T00:00:00.000Z'),
    },
    {
      documentId: ids.documents.failure,
      versionId: ids.versions.failure,
      type: 'RIGHT_TO_WORK' as const,
      status: 'APPROVED' as const,
      expiryDate: null,
    },
    {
      documentId: ids.documents.retry,
      versionId: ids.versions.retry,
      type: 'RIGHT_TO_WORK' as const,
      status: 'APPROVED' as const,
      expiryDate: new Date('2035-08-01T00:00:00.000Z'),
    },
    {
      documentId: ids.documents.concurrent,
      versionId: ids.versions.concurrent,
      type: 'RIGHT_TO_WORK' as const,
      status: 'APPROVED' as const,
      expiryDate: new Date('2035-08-01T00:00:00.000Z'),
    },
    {
      documentId: ids.documents.second,
      versionId: ids.versions.second,
      type: 'RIGHT_TO_WORK' as const,
      status: 'APPROVED' as const,
      expiryDate: new Date('2035-08-01T00:00:00.000Z'),
    },
    {
      documentId: ids.documents.ineligible,
      versionId: ids.versions.ineligible,
      type: 'BACKGROUND_CHECK' as const,
      status: 'APPROVED' as const,
      expiryDate: new Date('2035-08-01T00:00:00.000Z'),
    },
  ];

  await adminPrisma.$transaction(async (transaction) => {
    for (const fixture of fixtures) {
      await transaction.complianceDocument.create({
        data: {
          id: fixture.documentId,
          tenantId: ids.tenants.zauroh,
          candidateId: ids.candidate,
          type: fixture.type,
        },
      });
      await transaction.complianceDocumentVersion.create({
        data: {
          id: fixture.versionId,
          tenantId: ids.tenants.zauroh,
          documentId: fixture.documentId,
          versionNumber: 1,
          issueDate: new Date('2025-08-01T00:00:00.000Z'),
          expiryDate: fixture.expiryDate,
          status: fixture.status,
          createdBy: ids.memberships.recruiter,
        },
      });
      await transaction.complianceDocument.update({
        where: { id: fixture.documentId },
        data: { currentVersionId: fixture.versionId },
      });
    }
  });
}

beforeAll(async () => {
  const membership = await adminPrisma.tenantMembership.count({
    where: { id: ids.memberships.recruiter },
  });

  if (membership !== 1) {
    throw new Error('Run pnpm db:seed before verification integration tests.');
  }
});

beforeEach(async () => {
  await cleanFixtures();
  await createFixtures();
});

afterAll(async () => {
  await cleanFixtures();
  await Promise.all([runtimePrisma.$disconnect(), adminPrisma.$disconnect()]);
});

describe('Right-to-Work verification workflow', () => {
  it('creates one request, outbox event, and audit event with 202', async () => {
    const response = await submitVerification(
      ids.documents.success,
      'phase4-create',
    );

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({
      documentId: ids.documents.success,
      documentVersionId: ids.versions.success,
      status: 'requested',
      attemptCount: 0,
      failureCode: null,
      startedAt: null,
      completedAt: null,
    });
    await expect(
      adminPrisma.verificationRequest.count({
        where: { documentId: ids.documents.success },
      }),
    ).resolves.toBe(1);
    await expect(
      adminPrisma.outboxEvent.count({
        where: { verificationRequestId: response.body.id },
      }),
    ).resolves.toBe(1);
    await expect(
      adminPrisma.auditEvent.count({
        where: {
          recordId: response.body.id,
          action: AUDIT_ACTIONS.verificationRequest,
        },
      }),
    ).resolves.toBe(1);
  });

  it('rolls back the complete creation unit when the document is ineligible', async () => {
    const response = await submitVerification(
      ids.documents.ineligible,
      'phase4-ineligible',
    );

    expect(response.status).toBe(409);
    expect(response.body).toEqual(eligibilityProblem);
    await expect(
      adminPrisma.verificationRequest.count({
        where: { documentId: ids.documents.ineligible },
      }),
    ).resolves.toBe(0);
    await expect(
      adminPrisma.idempotencyRecord.count({
        where: { key: 'phase4-ineligible' },
      }),
    ).resolves.toBe(0);
    await expect(
      adminPrisma.auditEvent.count({
        where: { recordId: ids.documents.ineligible },
      }),
    ).resolves.toBe(0);
  });

  it('returns 403 before submission when permission is missing', async () => {
    const response = await submitVerification(
      ids.documents.success,
      'phase4-forbidden',
      ids.users.viewer,
    );

    expect(response.status).toBe(403);
    expect(response.body).toEqual(forbiddenProblem);
    await expect(countFixtureRequests()).resolves.toBe(0);
  });

  it('blocks cross-tenant submission and status access', async () => {
    const created = await submitVerification(
      ids.documents.success,
      'phase4-cross-tenant-source',
    );
    const submission = await submitVerification(
      ids.documents.success,
      'phase4-cross-tenant-submit',
      ids.users.viewer,
      ids.tenants.khaleel,
    );
    const status = await readVerification(
      created.body.id,
      ids.users.viewer,
      ids.tenants.khaleel,
    );

    expect(created.status).toBe(202);
    expect(submission.status).toBe(404);
    expect(submission.body).toEqual(documentNotFoundProblem);
    expect(status.status).toBe(404);
    expect(status.body).toEqual(verificationNotFoundProblem);
  });

  it('replays the original 202 without duplicate durable records', async () => {
    const first = await submitVerification(
      ids.documents.success,
      'phase4-replay',
    );
    const replay = await submitVerification(
      ids.documents.success,
      'phase4-replay',
    );

    expect(first.status).toBe(202);
    expect(replay.status).toBe(202);
    expect(replay.body).toEqual(first.body);
    await expect(countFixtureRequests()).resolves.toBe(1);
    await expect(countFixtureOutboxEvents()).resolves.toBe(1);
    await expect(
      adminPrisma.auditEvent.count({
        where: {
          recordId: first.body.id,
          action: AUDIT_ACTIONS.verificationRequest,
        },
      }),
    ).resolves.toBe(1);
  });

  it('returns 409 when one key is reused for a different document', async () => {
    const first = await submitVerification(
      ids.documents.success,
      'phase4-conflict',
    );
    const conflict = await submitVerification(
      ids.documents.second,
      'phase4-conflict',
    );

    expect(first.status).toBe(202);
    expect(conflict.status).toBe(409);
    expect(conflict.body).toEqual(idempotencyConflictProblem);
    await expect(
      adminPrisma.verificationRequest.count({
        where: { documentId: ids.documents.second },
      }),
    ).resolves.toBe(0);
  });

  it('commits requested, pending, and verified states with audit history', async () => {
    const created = await submitVerification(
      ids.documents.success,
      'phase4-success',
    );
    let observedPending = false;
    const result = await processNextVerificationEvent({
      prisma: runtimePrisma,
      workerId: 'phase4-success-worker',
      verifier: {
        async verify() {
          const pending =
            await adminPrisma.verificationRequest.findUniqueOrThrow({
              where: { id: created.body.id },
            });
          observedPending = pending.status === 'PENDING';
          return { outcome: 'verified' };
        },
      },
    });
    const stored = await adminPrisma.verificationRequest.findUniqueOrThrow({
      where: { id: created.body.id },
    });
    const actions = (
      await adminPrisma.auditEvent.findMany({
        where: { recordId: created.body.id },
        orderBy: { createdAt: 'asc' },
      })
    ).map(({ action }) => action);

    expect(created.status).toBe(202);
    expect(observedPending).toBe(true);
    expect(result.outcome).toBe('verified');
    expect(stored).toMatchObject({
      status: 'VERIFIED',
      attemptCount: 1,
      failureCode: null,
    });
    expect(actions).toEqual([
      AUDIT_ACTIONS.verificationRequest,
      AUDIT_ACTIONS.verificationPending,
      AUDIT_ACTIONS.verificationVerified,
    ]);

    const status = await readVerification(created.body.id);
    expect(status.status).toBe(200);
    expect(status.body.status).toBe('verified');
    await expect(
      adminPrisma.auditEvent.count({
        where: {
          recordId: created.body.id,
          action: AUDIT_ACTIONS.verificationRead,
        },
      }),
    ).resolves.toBe(1);
  });

  it('uses the deterministic local mock to reach failed', async () => {
    const created = await submitVerification(
      ids.documents.failure,
      'phase4-mock-failure',
    );
    const result = await processNextVerificationEvent({
      prisma: runtimePrisma,
      workerId: 'phase4-failure-worker',
      verifier: new DeterministicLocalRightToWorkVerifier(
        () => new Date('2026-08-14T12:00:00.000Z'),
      ),
    });
    const stored = await adminPrisma.verificationRequest.findUniqueOrThrow({
      where: { id: created.body.id },
    });

    expect(result.outcome).toBe('failed');
    expect(stored).toMatchObject({
      status: 'FAILED',
      failureCode: 'MOCK_EXPIRY_MISSING',
      attemptCount: 1,
    });
  });

  it('retries safely without duplicating logical work', async () => {
    const created = await submitVerification(
      ids.documents.retry,
      'phase4-retry',
    );
    let calls = 0;
    const verifier = {
      async verify() {
        calls += 1;
        if (calls === 1) {
          throw new Error('transient test failure');
        }
        return { outcome: 'verified' as const };
      },
    };
    const first = await processNextVerificationEvent({
      prisma: runtimePrisma,
      workerId: 'phase4-retry-worker',
      verifier,
      retryDelayMs: 0,
    });
    const second = await processNextVerificationEvent({
      prisma: runtimePrisma,
      workerId: 'phase4-retry-worker',
      verifier,
      retryDelayMs: 0,
    });

    expect(first.outcome).toBe('retry_scheduled');
    expect(second.outcome).toBe('verified');
    expect(calls).toBe(2);
    await expect(countFixtureRequests()).resolves.toBe(1);
    await expect(countFixtureOutboxEvents()).resolves.toBe(1);
    await expect(
      adminPrisma.auditEvent.count({
        where: {
          recordId: created.body.id,
          action: AUDIT_ACTIONS.verificationPending,
        },
      }),
    ).resolves.toBe(1);
  });

  it('prevents concurrent workers from processing one event twice', async () => {
    await submitVerification(ids.documents.concurrent, 'phase4-concurrent');
    let calls = 0;
    let releaseVerifier: (() => void) | undefined;
    let announceStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      announceStarted = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseVerifier = resolve;
    });
    const verifier = {
      async verify() {
        calls += 1;
        announceStarted?.();
        await released;
        return { outcome: 'verified' as const };
      },
    };

    const firstWorker = processNextVerificationEvent({
      prisma: runtimePrisma,
      workerId: 'phase4-concurrent-a',
      verifier,
    });
    await started;
    const secondWorker = await processNextVerificationEvent({
      prisma: runtimePrisma,
      workerId: 'phase4-concurrent-b',
      verifier,
    });
    releaseVerifier?.();
    const firstResult = await firstWorker;

    expect(secondWorker.outcome).toBe('idle');
    expect(firstResult.outcome).toBe('verified');
    expect(calls).toBe(1);
  });

  it('does not reprocess a completed event', async () => {
    await submitVerification(ids.documents.success, 'phase4-completed');
    let calls = 0;
    const verifier = {
      async verify() {
        calls += 1;
        return { outcome: 'verified' as const };
      },
    };
    const first = await processNextVerificationEvent({
      prisma: runtimePrisma,
      workerId: 'phase4-completed-worker',
      verifier,
    });
    const second = await processNextVerificationEvent({
      prisma: runtimePrisma,
      workerId: 'phase4-completed-worker',
      verifier,
    });

    expect(first.outcome).toBe('verified');
    expect(second.outcome).toBe('idle');
    expect(calls).toBe(1);
  });

  it('bounds retry attempts and records only a minimal terminal code', async () => {
    const created = await submitVerification(
      ids.documents.retry,
      'phase4-bounded',
    );
    let calls = 0;
    const verifier = {
      async verify(): Promise<never> {
        calls += 1;
        throw new Error('sensitive upstream details must not be stored');
      },
    };
    const outcomes = [];

    for (let attempt = 0; attempt < 3; attempt += 1) {
      outcomes.push(
        await processNextVerificationEvent({
          prisma: runtimePrisma,
          workerId: 'phase4-bounded-worker',
          verifier,
          retryDelayMs: 0,
        }),
      );
    }
    const afterCompletion = await processNextVerificationEvent({
      prisma: runtimePrisma,
      workerId: 'phase4-bounded-worker',
      verifier,
      retryDelayMs: 0,
    });
    const stored = await adminPrisma.verificationRequest.findUniqueOrThrow({
      where: { id: created.body.id },
    });
    const outbox = await adminPrisma.outboxEvent.findFirstOrThrow({
      where: { verificationRequestId: created.body.id },
    });

    expect(outcomes.map(({ outcome }) => outcome)).toEqual([
      'retry_scheduled',
      'retry_scheduled',
      'failed',
    ]);
    expect(afterCompletion.outcome).toBe('idle');
    expect(calls).toBe(3);
    expect(stored).toMatchObject({
      status: 'FAILED',
      attemptCount: 3,
      failureCode: 'MAX_ATTEMPTS_EXCEEDED',
    });
    expect(outbox).toMatchObject({
      attempts: 3,
      lastErrorCode: 'MAX_ATTEMPTS_EXCEEDED',
    });
    expect(JSON.stringify({ stored, outbox })).not.toContain(
      'sensitive upstream details',
    );
  });

  it('terminalises an exhausted lease without another verifier call', async () => {
    const created = await submitVerification(
      ids.documents.retry,
      'phase4-exhausted-recovery',
    );
    await adminPrisma.outboxEvent.updateMany({
      where: { verificationRequestId: created.body.id },
      data: {
        attempts: 3,
        availableAt: new Date('2026-08-14T00:00:00.000Z'),
        lockedAt: null,
        lockedUntil: null,
        lockedBy: null,
      },
    });
    let calls = 0;
    const result = await processNextVerificationEvent({
      prisma: runtimePrisma,
      workerId: 'phase4-exhausted-worker',
      verifier: {
        async verify() {
          calls += 1;
          return { outcome: 'verified' };
        },
      },
    });
    const stored = await adminPrisma.verificationRequest.findUniqueOrThrow({
      where: { id: created.body.id },
    });
    const outbox = await adminPrisma.outboxEvent.findFirstOrThrow({
      where: { verificationRequestId: created.body.id },
    });

    expect(result.outcome).toBe('failed');
    expect(calls).toBe(0);
    expect(stored).toMatchObject({
      status: 'FAILED',
      attemptCount: 3,
      failureCode: 'MAX_ATTEMPTS_EXCEEDED',
    });
    expect(outbox.processedAt).not.toBeNull();
    await expect(
      adminPrisma.auditEvent.count({
        where: {
          recordId: created.body.id,
          action: {
            in: [
              AUDIT_ACTIONS.verificationPending,
              AUDIT_ACTIONS.verificationFailed,
            ],
          },
        },
      }),
    ).resolves.toBe(2);
  });
});

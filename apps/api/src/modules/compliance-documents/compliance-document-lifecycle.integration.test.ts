import { ComplianceDocumentStatus, PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { loadEnvironment } from '../../config/load-environment.js';
import { canonicalHash } from '../../infrastructure/crypto/canonical-hash.js';
import { AUDIT_ACTIONS } from '../audit/audit.service.js';

loadEnvironment();

const runtimePrisma = new PrismaClient();
const adminPrisma = new PrismaClient({
  datasourceUrl: process.env.DIRECT_DATABASE_URL,
});
const jwtConfig = {
  secret: 'document-lifecycle-integration-test-secret',
  expiresIn: '15m' as const,
};
const app = createApp({ prisma: runtimePrisma, jwtConfig });

const ids = {
  tenant: '10000000-0000-4000-8000-000000000001',
  users: {
    recruiter: '20000000-0000-4000-8000-000000000002',
    compliance: '20000000-0000-4000-8000-000000000003',
  },
  memberships: {
    compliance: '30000000-0000-4000-8000-000000000003',
  },
  candidate: '45000000-0000-4000-8000-000000000001',
  documents: {
    draft: '55000000-0000-4000-8000-000000000001',
    rejected: '55000000-0000-4000-8000-000000000002',
    approved: '55000000-0000-4000-8000-000000000003',
    secondDraft: '55000000-0000-4000-8000-000000000004',
    khaleel: '50000000-0000-4000-8000-000000000002',
    nonexistent: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  },
  versions: {
    draft: '65000000-0000-4000-8000-000000000001',
    rejected: '65000000-0000-4000-8000-000000000002',
    approved: '65000000-0000-4000-8000-000000000003',
    secondDraft: '65000000-0000-4000-8000-000000000004',
  },
} as const;

const forbiddenProblem = {
  type: 'about:blank',
  title: 'Forbidden',
  status: 403,
  detail: 'You do not have permission to perform this operation.',
};
const notFoundProblem = {
  type: 'about:blank',
  title: 'Not Found',
  status: 404,
  detail: 'Compliance document was not found.',
};
const approvalConflictProblem = {
  type: 'about:blank',
  title: 'Conflict',
  status: 409,
  detail:
    'The current document version cannot be approved from its current status.',
};
const correctionConflictProblem = {
  type: 'about:blank',
  title: 'Conflict',
  status: 409,
  detail: 'Only an approved current document version can be corrected.',
};
const approvedVersionConflictProblem = {
  type: 'about:blank',
  title: 'Conflict',
  status: 409,
  detail:
    'Approved document versions must be changed through the correction operation.',
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

function lifecycleRequest(
  operation: 'approve' | 'corrections' | 'versions',
  documentId: string,
  userId: string,
  key: string,
) {
  return request(app)
    .post(`/api/v1/documents/${documentId}/${operation}`)
    .set('Authorization', `Bearer ${tokenFor(userId)}`)
    .set('X-Tenant-Id', ids.tenant)
    .set('Idempotency-Key', key);
}

function correctionInput(expiryDate = '2036-08-01') {
  return {
    issueDate: '2035-08-01',
    expiryDate,
  };
}

async function cleanFixtures(): Promise<void> {
  const documentIds = Object.values(ids.documents).filter(
    (id) => id !== ids.documents.khaleel,
  );

  await adminPrisma.auditEvent.deleteMany({
    where: { recordId: { in: documentIds } },
  });
  await adminPrisma.idempotencyRecord.deleteMany({
    where: { key: { startsWith: 'phase3b-' } },
  });
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
  await adminPrisma.candidate.deleteMany({
    where: { id: ids.candidate },
  });
}

async function createFixtures(): Promise<void> {
  await adminPrisma.candidate.create({
    data: {
      id: ids.candidate,
      tenantId: ids.tenant,
      fullName: 'Phase 3B Candidate',
      email: 'document.lifecycle@phase3b.test',
      roleAppliedFor: 'Phase Three Specialist',
    },
  });

  const fixtures = [
    {
      documentId: ids.documents.draft,
      versionId: ids.versions.draft,
      status: ComplianceDocumentStatus.DRAFT,
    },
    {
      documentId: ids.documents.rejected,
      versionId: ids.versions.rejected,
      status: ComplianceDocumentStatus.REJECTED,
    },
    {
      documentId: ids.documents.approved,
      versionId: ids.versions.approved,
      status: ComplianceDocumentStatus.APPROVED,
    },
    {
      documentId: ids.documents.secondDraft,
      versionId: ids.versions.secondDraft,
      status: ComplianceDocumentStatus.DRAFT,
    },
  ];

  await adminPrisma.$transaction(async (transaction) => {
    for (const fixture of fixtures) {
      await transaction.complianceDocument.create({
        data: {
          id: fixture.documentId,
          tenantId: ids.tenant,
          candidateId: ids.candidate,
          type: 'PROFESSIONAL_CERTIFICATION',
        },
      });
      await transaction.complianceDocumentVersion.create({
        data: {
          id: fixture.versionId,
          tenantId: ids.tenant,
          documentId: fixture.documentId,
          versionNumber: 1,
          issueDate: new Date('2034-08-01T00:00:00.000Z'),
          expiryDate: new Date('2035-08-01T00:00:00.000Z'),
          status: fixture.status,
          supersedesVersionId: null,
          createdBy: ids.memberships.compliance,
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
    where: { id: ids.memberships.compliance },
  });

  if (membership !== 1) {
    throw new Error('Run pnpm db:seed before lifecycle integration tests.');
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

describe('approved compliance-document lifecycle', () => {
  it('allows an authorised actor to approve the eligible current version', async () => {
    const response = await lifecycleRequest(
      'approve',
      ids.documents.draft,
      ids.users.compliance,
      'phase3b-approve',
    ).send({});
    const stored =
      await adminPrisma.complianceDocumentVersion.findUniqueOrThrow({
        where: { id: ids.versions.draft },
      });
    const audit = await adminPrisma.auditEvent.findMany({
      where: {
        recordId: ids.documents.draft,
        action: AUDIT_ACTIONS.documentApprove,
      },
    });

    expect(response.status).toBe(200);
    expect(response.body.currentVersion.status).toBe('APPROVED');
    expect(stored.status).toBe('APPROVED');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorUserId: ids.users.compliance,
      membershipId: ids.memberships.compliance,
    });
    expect(audit[0]?.beforeHash).not.toBe(audit[0]?.afterHash);
  });

  it('returns 403 before approval or correction when permission is missing', async () => {
    const [approval, correction] = await Promise.all([
      lifecycleRequest(
        'approve',
        ids.documents.draft,
        ids.users.recruiter,
        'phase3b-forbidden-approve',
      ).send({}),
      lifecycleRequest(
        'corrections',
        ids.documents.approved,
        ids.users.recruiter,
        'phase3b-forbidden-correct',
      ).send(correctionInput()),
    ]);

    expect(approval.status).toBe(403);
    expect(approval.body).toEqual(forbiddenProblem);
    expect(correction.status).toBe(403);
    expect(correction.body).toEqual(forbiddenProblem);
    await expect(
      adminPrisma.auditEvent.count({
        where: {
          action: {
            in: [AUDIT_ACTIONS.documentApprove, AUDIT_ACTIONS.documentCorrect],
          },
          recordId: { in: [ids.documents.draft, ids.documents.approved] },
        },
      }),
    ).resolves.toBe(0);
    await expect(
      adminPrisma.idempotencyRecord.count({
        where: {
          key: {
            in: ['phase3b-forbidden-approve', 'phase3b-forbidden-correct'],
          },
        },
      }),
    ).resolves.toBe(0);
  });

  it('hides cross-tenant documents from approval and correction', async () => {
    const approvalAuditBefore = await adminPrisma.auditEvent.count({
      where: {
        action: AUDIT_ACTIONS.documentApprove,
        recordId: ids.documents.khaleel,
      },
    });
    const [approval, missingApproval, correction] = await Promise.all([
      lifecycleRequest(
        'approve',
        ids.documents.khaleel,
        ids.users.compliance,
        'phase3b-cross-tenant-approve',
      ).send({}),
      lifecycleRequest(
        'approve',
        ids.documents.nonexistent,
        ids.users.compliance,
        'phase3b-missing-approve',
      ).send({}),
      lifecycleRequest(
        'corrections',
        ids.documents.khaleel,
        ids.users.compliance,
        'phase3b-cross-tenant-correct',
      ).send(correctionInput()),
    ]);

    expect(approval.status).toBe(404);
    expect(approval.body).toEqual(notFoundProblem);
    expect(missingApproval.status).toBe(404);
    expect(missingApproval.body).toEqual(notFoundProblem);
    expect(correction.status).toBe(404);
    expect(correction.body).toEqual(notFoundProblem);
    await expect(
      adminPrisma.auditEvent.count({
        where: {
          action: AUDIT_ACTIONS.documentApprove,
          recordId: ids.documents.khaleel,
        },
      }),
    ).resolves.toBe(approvalAuditBefore);
    await expect(
      adminPrisma.auditEvent.count({
        where: {
          action: AUDIT_ACTIONS.documentApprove,
          recordId: ids.documents.nonexistent,
        },
      }),
    ).resolves.toBe(0);
    await expect(
      adminPrisma.idempotencyRecord.count({
        where: {
          key: {
            in: [
              'phase3b-cross-tenant-approve',
              'phase3b-missing-approve',
              'phase3b-cross-tenant-correct',
            ],
          },
        },
      }),
    ).resolves.toBe(0);
  });

  it('corrects an approved version by superseding it with one new DRAFT', async () => {
    const before =
      await adminPrisma.complianceDocumentVersion.findUniqueOrThrow({
        where: { id: ids.versions.approved },
      });
    const response = await lifecycleRequest(
      'corrections',
      ids.documents.approved,
      ids.users.compliance,
      'phase3b-correct',
    ).send(correctionInput());
    const stored = await adminPrisma.complianceDocument.findUniqueOrThrow({
      where: { id: ids.documents.approved },
      include: { versions: { orderBy: { versionNumber: 'asc' } } },
    });
    const audit = await adminPrisma.auditEvent.findMany({
      where: {
        recordId: ids.documents.approved,
        action: AUDIT_ACTIONS.documentCorrect,
      },
    });

    expect(response.status).toBe(201);
    expect(response.body.currentVersion).toMatchObject({
      versionNumber: 2,
      status: 'DRAFT',
      issueDate: '2035-08-01',
      expiryDate: '2036-08-01',
    });
    expect(stored.versions).toHaveLength(2);
    expect(stored.versions[0]).toEqual(before);
    expect(stored.versions[1]).toMatchObject({
      versionNumber: 2,
      status: 'DRAFT',
      supersedesVersionId: ids.versions.approved,
      createdBy: ids.memberships.compliance,
    });
    expect(stored.currentVersionId).toBe(stored.versions[1]?.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.beforeHash).not.toBe(audit[0]?.afterHash);
  });

  it('returns explicit conflicts for invalid transitions without partial state', async () => {
    const [approval, correction, genericVersion] = await Promise.all([
      lifecycleRequest(
        'approve',
        ids.documents.rejected,
        ids.users.compliance,
        'phase3b-invalid-approve',
      ).send({}),
      lifecycleRequest(
        'corrections',
        ids.documents.draft,
        ids.users.compliance,
        'phase3b-invalid-correct',
      ).send(correctionInput()),
      lifecycleRequest(
        'versions',
        ids.documents.approved,
        ids.users.compliance,
        'phase3b-approved-generic-version',
      ).send({ issueDate: '2035-08-01', expiryDate: '2036-08-01' }),
    ]);
    const draft = await adminPrisma.complianceDocument.findUniqueOrThrow({
      where: { id: ids.documents.draft },
      include: { versions: true },
    });

    expect(approval.status).toBe(409);
    expect(approval.body).toEqual(approvalConflictProblem);
    expect(correction.status).toBe(409);
    expect(correction.body).toEqual(correctionConflictProblem);
    expect(genericVersion.status).toBe(409);
    expect(genericVersion.body).toEqual(approvedVersionConflictProblem);
    expect(draft.currentVersionId).toBe(ids.versions.draft);
    expect(draft.versions).toHaveLength(1);
    await expect(
      adminPrisma.auditEvent.count({
        where: {
          recordId: { in: [ids.documents.rejected, ids.documents.draft] },
          action: {
            in: [AUDIT_ACTIONS.documentApprove, AUDIT_ACTIONS.documentCorrect],
          },
        },
      }),
    ).resolves.toBe(0);
    await expect(
      adminPrisma.idempotencyRecord.count({
        where: { key: { startsWith: 'phase3b-invalid-' } },
      }),
    ).resolves.toBe(0);
  });

  it('distinguishes same-key replay from a new-key semantic re-approval', async () => {
    const first = await lifecycleRequest(
      'approve',
      ids.documents.draft,
      ids.users.compliance,
      'phase3b-approve-replay',
    ).send({});
    const replay = await lifecycleRequest(
      'approve',
      ids.documents.draft,
      ids.users.compliance,
      'phase3b-approve-replay',
    ).send({});
    const afterFirst = await adminPrisma.complianceDocument.findUniqueOrThrow({
      where: { id: ids.documents.draft },
      include: { versions: true },
    });
    const auditCountAfterReplay = await adminPrisma.auditEvent.count({
      where: {
        recordId: ids.documents.draft,
        action: AUDIT_ACTIONS.documentApprove,
      },
    });
    const semanticRetry = await lifecycleRequest(
      'approve',
      ids.documents.draft,
      ids.users.compliance,
      'phase3b-approve-second-key',
    ).send({});
    const semanticReplay = await lifecycleRequest(
      'approve',
      ids.documents.draft,
      ids.users.compliance,
      'phase3b-approve-second-key',
    ).send({});
    const afterSemantic =
      await adminPrisma.complianceDocument.findUniqueOrThrow({
        where: { id: ids.documents.draft },
        include: { versions: true },
      });
    const audits = await adminPrisma.auditEvent.findMany({
      where: {
        recordId: ids.documents.draft,
        action: AUDIT_ACTIONS.documentApprove,
      },
    });
    const semanticAudit = audits.find(
      (event) =>
        (event.metadata as { outcome?: string }).outcome === 'ALREADY_APPROVED',
    );
    const idempotencyRecords = await adminPrisma.idempotencyRecord.findMany({
      where: {
        operation: 'document:approve',
        key: {
          in: ['phase3b-approve-replay', 'phase3b-approve-second-key'],
        },
      },
    });

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(semanticRetry.status).toBe(200);
    expect(semanticReplay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(semanticRetry.body).toEqual(first.body);
    expect(semanticReplay.body).toEqual(semanticRetry.body);
    expect(auditCountAfterReplay).toBe(1);
    expect(afterSemantic).toEqual(afterFirst);
    expect(audits).toHaveLength(2);
    expect(
      audits.filter(
        (event) => Object.keys(event.metadata as object).length === 0,
      ),
    ).toHaveLength(1);
    expect(semanticAudit?.metadata).toEqual({ outcome: 'ALREADY_APPROVED' });
    expect(semanticAudit?.beforeHash).toBe(semanticAudit?.afterHash);
    expect(semanticAudit?.afterHash).toBe(canonicalHash(first.body));
    expect(idempotencyRecords).toHaveLength(2);
    expect(
      idempotencyRecords.every((record) => record.responseStatus === 200),
    ).toBe(true);
  });

  it('returns 409 for conflicting approval-key reuse without another audit', async () => {
    const key = 'phase3b-approve-conflict';
    const first = await lifecycleRequest(
      'approve',
      ids.documents.approved,
      ids.users.compliance,
      key,
    ).send({});
    const conflict = await lifecycleRequest(
      'approve',
      ids.documents.secondDraft,
      ids.users.compliance,
      key,
    ).send({});

    expect(first.status).toBe(200);
    expect(conflict.status).toBe(409);
    expect(conflict.body).toEqual(idempotencyConflictProblem);
    await expect(
      adminPrisma.auditEvent.count({
        where: {
          action: AUDIT_ACTIONS.documentApprove,
          recordId: ids.documents.approved,
        },
      }),
    ).resolves.toBe(1);
    await expect(
      adminPrisma.auditEvent.count({
        where: {
          action: AUDIT_ACTIONS.documentApprove,
          recordId: ids.documents.secondDraft,
        },
      }),
    ).resolves.toBe(0);
    await expect(
      adminPrisma.complianceDocumentVersion.findUniqueOrThrow({
        where: { id: ids.versions.secondDraft },
      }),
    ).resolves.toMatchObject({ status: ComplianceDocumentStatus.DRAFT });
  });

  it('deduplicates concurrent same-key semantic re-approval', async () => {
    const before = await adminPrisma.complianceDocument.findUniqueOrThrow({
      where: { id: ids.documents.approved },
      include: { versions: true },
    });
    const key = 'phase3b-approved-concurrent-same-key';
    const responses = await Promise.all([
      lifecycleRequest(
        'approve',
        ids.documents.approved,
        ids.users.compliance,
        key,
      ).send({}),
      lifecycleRequest(
        'approve',
        ids.documents.approved,
        ids.users.compliance,
        key,
      ).send({}),
    ]);
    const after = await adminPrisma.complianceDocument.findUniqueOrThrow({
      where: { id: ids.documents.approved },
      include: { versions: true },
    });

    expect(responses.map(({ status }) => status)).toEqual([200, 200]);
    expect(responses[1]?.body).toEqual(responses[0]?.body);
    expect(after).toEqual(before);
    await expect(
      adminPrisma.auditEvent.count({
        where: {
          action: AUDIT_ACTIONS.documentApprove,
          recordId: ids.documents.approved,
        },
      }),
    ).resolves.toBe(1);
    await expect(
      adminPrisma.idempotencyRecord.count({
        where: { operation: 'document:approve', key },
      }),
    ).resolves.toBe(1);
  });

  it('audits each concurrent distinct-key semantic re-approval', async () => {
    const before = await adminPrisma.complianceDocument.findUniqueOrThrow({
      where: { id: ids.documents.approved },
      include: { versions: true },
    });
    const keys = [
      'phase3b-approved-concurrent-key-one',
      'phase3b-approved-concurrent-key-two',
    ];
    const responses = await Promise.all(
      keys.map((key) =>
        lifecycleRequest(
          'approve',
          ids.documents.approved,
          ids.users.compliance,
          key,
        ).send({}),
      ),
    );
    const after = await adminPrisma.complianceDocument.findUniqueOrThrow({
      where: { id: ids.documents.approved },
      include: { versions: true },
    });
    const audits = await adminPrisma.auditEvent.findMany({
      where: {
        action: AUDIT_ACTIONS.documentApprove,
        recordId: ids.documents.approved,
      },
    });

    expect(responses.map(({ status }) => status)).toEqual([200, 200]);
    expect(after).toEqual(before);
    expect(audits).toHaveLength(2);
    expect(
      audits.every(
        (event) =>
          event.beforeHash === event.afterHash &&
          (event.metadata as { outcome?: string }).outcome ===
            'ALREADY_APPROVED',
      ),
    ).toBe(true);
    await expect(
      adminPrisma.idempotencyRecord.count({
        where: { operation: 'document:approve', key: { in: keys } },
      }),
    ).resolves.toBe(2);
  });

  it('replays concurrent identical corrections without duplicate versions or audit events', async () => {
    const requests = await Promise.all([
      lifecycleRequest(
        'corrections',
        ids.documents.approved,
        ids.users.compliance,
        'phase3b-correction-replay',
      ).send(correctionInput()),
      lifecycleRequest(
        'corrections',
        ids.documents.approved,
        ids.users.compliance,
        'phase3b-correction-replay',
      ).send(correctionInput()),
    ]);

    expect(requests.map(({ status }) => status)).toEqual([201, 201]);
    expect(requests[1]?.body).toEqual(requests[0]?.body);
    await expect(
      adminPrisma.complianceDocumentVersion.count({
        where: { documentId: ids.documents.approved },
      }),
    ).resolves.toBe(2);
    await expect(
      adminPrisma.auditEvent.count({
        where: {
          recordId: ids.documents.approved,
          action: AUDIT_ACTIONS.documentCorrect,
        },
      }),
    ).resolves.toBe(1);
  });

  it('returns 409 when a correction key is reused with different dates', async () => {
    const first = await lifecycleRequest(
      'corrections',
      ids.documents.approved,
      ids.users.compliance,
      'phase3b-correction-conflict',
    ).send(correctionInput());
    const conflict = await lifecycleRequest(
      'corrections',
      ids.documents.approved,
      ids.users.compliance,
      'phase3b-correction-conflict',
    ).send(correctionInput('2037-08-01'));

    expect(first.status).toBe(201);
    expect(conflict.status).toBe(409);
    expect(conflict.body).toEqual(idempotencyConflictProblem);
    await expect(
      adminPrisma.complianceDocumentVersion.count({
        where: { documentId: ids.documents.approved },
      }),
    ).resolves.toBe(2);
    await expect(
      adminPrisma.auditEvent.count({
        where: {
          recordId: ids.documents.approved,
          action: AUDIT_ACTIONS.documentCorrect,
        },
      }),
    ).resolves.toBe(1);
  });
});

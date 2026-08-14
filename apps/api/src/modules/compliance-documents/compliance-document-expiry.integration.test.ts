import {
  ComplianceDocumentStatus,
  ComplianceDocumentType,
  PrismaClient,
} from '@prisma/client';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { loadEnvironment } from '../../config/load-environment.js';

loadEnvironment();

const runtimePrisma = new PrismaClient();
const adminPrisma = new PrismaClient({
  datasourceUrl: process.env.DIRECT_DATABASE_URL,
});
const referenceNow = new Date('2026-08-14T23:45:00.000Z');
const jwtConfig = {
  secret: 'compliance-document-expiry-integration-test-secret',
  expiresIn: '15m' as const,
};
const app = createApp({
  prisma: runtimePrisma,
  jwtConfig,
  now: () => referenceNow,
});

const ids = {
  tenants: {
    zauroh: '10000000-0000-4000-8000-000000000001',
    khaleel: '10000000-0000-4000-8000-000000000002',
  },
  users: {
    admin: '20000000-0000-4000-8000-000000000001',
    recruiter: '20000000-0000-4000-8000-000000000002',
    compliance: '20000000-0000-4000-8000-000000000003',
    shared: '20000000-0000-4000-8000-000000000004',
  },
  memberships: {
    zaurohAdmin: '30000000-0000-4000-8000-000000000001',
    khaleelShared: '30000000-0000-4000-8000-000000000005',
  },
  candidates: {
    zauroh: '42000000-0000-4000-8000-000000000001',
    khaleel: '42000000-0000-4000-8000-000000000002',
  },
  documents: {
    yesterday: '52000000-0000-4000-8000-000000000001',
    today: '52000000-0000-4000-8000-000000000002',
    dayOne: '52000000-0000-4000-8000-000000000003',
    dayTwentyNine: '52000000-0000-4000-8000-000000000004',
    dayThirty: '52000000-0000-4000-8000-000000000005',
    dayThirtyOne: '52000000-0000-4000-8000-000000000006',
    nullExpiry: '52000000-0000-4000-8000-000000000007',
    oldSoonCurrentFuture: '52000000-0000-4000-8000-000000000008',
    oldFutureCurrentSoon: '52000000-0000-4000-8000-000000000009',
    khaleelDayOne: '52000000-0000-4000-8000-000000000010',
  },
} as const;

interface FixtureVersion {
  id: string;
  expiryDate: Date | null;
  status?: ComplianceDocumentStatus;
}

interface DocumentFixture {
  id: string;
  tenantId: string;
  candidateId: string;
  createdBy: string;
  type?: ComplianceDocumentType;
  versions: FixtureVersion[];
}

function utcDate(dayOffset: number): Date {
  const date = new Date(
    Date.UTC(
      referenceNow.getUTCFullYear(),
      referenceNow.getUTCMonth(),
      referenceNow.getUTCDate(),
    ),
  );
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return date;
}

function versionId(sequence: number): string {
  return `62000000-0000-4000-8000-${sequence.toString().padStart(12, '0')}`;
}

const fixtures: DocumentFixture[] = [
  {
    id: ids.documents.yesterday,
    tenantId: ids.tenants.zauroh,
    candidateId: ids.candidates.zauroh,
    createdBy: ids.memberships.zaurohAdmin,
    versions: [{ id: versionId(1), expiryDate: utcDate(-1) }],
  },
  {
    id: ids.documents.today,
    tenantId: ids.tenants.zauroh,
    candidateId: ids.candidates.zauroh,
    createdBy: ids.memberships.zaurohAdmin,
    versions: [{ id: versionId(2), expiryDate: utcDate(0) }],
  },
  {
    id: ids.documents.dayOne,
    tenantId: ids.tenants.zauroh,
    candidateId: ids.candidates.zauroh,
    createdBy: ids.memberships.zaurohAdmin,
    type: ComplianceDocumentType.OTHER,
    versions: [{ id: versionId(3), expiryDate: utcDate(1) }],
  },
  {
    id: ids.documents.dayTwentyNine,
    tenantId: ids.tenants.zauroh,
    candidateId: ids.candidates.zauroh,
    createdBy: ids.memberships.zaurohAdmin,
    versions: [
      {
        id: versionId(4),
        expiryDate: utcDate(29),
        status: ComplianceDocumentStatus.PENDING_REVIEW,
      },
    ],
  },
  {
    id: ids.documents.dayThirty,
    tenantId: ids.tenants.zauroh,
    candidateId: ids.candidates.zauroh,
    createdBy: ids.memberships.zaurohAdmin,
    versions: [{ id: versionId(5), expiryDate: utcDate(30) }],
  },
  {
    id: ids.documents.dayThirtyOne,
    tenantId: ids.tenants.zauroh,
    candidateId: ids.candidates.zauroh,
    createdBy: ids.memberships.zaurohAdmin,
    versions: [{ id: versionId(6), expiryDate: utcDate(31) }],
  },
  {
    id: ids.documents.nullExpiry,
    tenantId: ids.tenants.zauroh,
    candidateId: ids.candidates.zauroh,
    createdBy: ids.memberships.zaurohAdmin,
    versions: [{ id: versionId(7), expiryDate: null }],
  },
  {
    id: ids.documents.oldSoonCurrentFuture,
    tenantId: ids.tenants.zauroh,
    candidateId: ids.candidates.zauroh,
    createdBy: ids.memberships.zaurohAdmin,
    versions: [
      { id: versionId(8), expiryDate: utcDate(1) },
      { id: versionId(9), expiryDate: utcDate(31) },
    ],
  },
  {
    id: ids.documents.oldFutureCurrentSoon,
    tenantId: ids.tenants.zauroh,
    candidateId: ids.candidates.zauroh,
    createdBy: ids.memberships.zaurohAdmin,
    versions: [
      { id: versionId(10), expiryDate: utcDate(31) },
      { id: versionId(11), expiryDate: utcDate(2) },
    ],
  },
  {
    id: ids.documents.khaleelDayOne,
    tenantId: ids.tenants.khaleel,
    candidateId: ids.candidates.khaleel,
    createdBy: ids.memberships.khaleelShared,
    versions: [{ id: versionId(12), expiryDate: utcDate(1) }],
  },
];

function tokenFor(userId: string): string {
  return jwt.sign({}, jwtConfig.secret, {
    algorithm: 'HS256',
    expiresIn: jwtConfig.expiresIn,
    subject: userId,
  });
}

function expiringRequest(userId: string, tenantId: string) {
  return request(app)
    .get('/api/v1/documents/expiring')
    .set('Authorization', `Bearer ${tokenFor(userId)}`)
    .set('X-Tenant-Id', tenantId);
}

async function cleanFixtures(): Promise<void> {
  const candidateIds = [ids.candidates.zauroh, ids.candidates.khaleel];
  const documents = await adminPrisma.complianceDocument.findMany({
    where: { candidateId: { in: candidateIds } },
    select: { id: true },
  });
  const documentIds = documents.map((document) => document.id);

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

beforeAll(async () => {
  await cleanFixtures();
  await adminPrisma.candidate.createMany({
    data: [
      {
        id: ids.candidates.zauroh,
        tenantId: ids.tenants.zauroh,
        fullName: 'Phase 2C Zauroh Candidate',
        email: 'zauroh.expiry.fixture@phase2c.test',
        roleAppliedFor: 'Phase Two C Fixture',
      },
      {
        id: ids.candidates.khaleel,
        tenantId: ids.tenants.khaleel,
        fullName: 'Phase 2C Khaleel Candidate',
        email: 'khaleel.expiry.fixture@phase2c.test',
        roleAppliedFor: 'Phase Two C Fixture',
      },
    ],
  });

  await adminPrisma.$transaction(async (transaction) => {
    for (const fixture of fixtures) {
      await transaction.complianceDocument.create({
        data: {
          id: fixture.id,
          tenantId: fixture.tenantId,
          candidateId: fixture.candidateId,
          type: fixture.type ?? ComplianceDocumentType.RIGHT_TO_WORK,
        },
      });

      for (const [index, version] of fixture.versions.entries()) {
        await transaction.complianceDocumentVersion.create({
          data: {
            id: version.id,
            tenantId: fixture.tenantId,
            documentId: fixture.id,
            versionNumber: index + 1,
            issueDate: utcDate(-365),
            expiryDate: version.expiryDate,
            status: version.status ?? ComplianceDocumentStatus.DRAFT,
            supersedesVersionId:
              index === 0 ? null : fixture.versions[index - 1]?.id,
            createdBy: fixture.createdBy,
          },
        });
      }

      await transaction.complianceDocument.update({
        where: { id: fixture.id },
        data: {
          currentVersionId: fixture.versions.at(-1)?.id,
        },
      });
    }
  });
});

afterAll(async () => {
  await cleanFixtures();
  await Promise.all([runtimePrisma.$disconnect(), adminPrisma.$disconnect()]);
});

describe('GET /api/v1/documents/expiring security boundary', () => {
  it('returns 401 when unauthenticated', async () => {
    const response = await request(app)
      .get('/api/v1/documents/expiring')
      .set('X-Tenant-Id', ids.tenants.zauroh);

    expect(response.status).toBe(401);
  });

  it('fails before authorisation when tenant context is missing', async () => {
    const response = await request(app)
      .get('/api/v1/documents/expiring')
      .set('Authorization', `Bearer ${tokenFor(ids.users.admin)}`);

    expect(response.status).toBe(400);
  });

  it('returns 403 when the actor is not a member of the selected tenant', async () => {
    const response = await expiringRequest(
      ids.users.admin,
      ids.tenants.khaleel,
    );

    expect(response.status).toBe(403);
  });

  it.each([
    ['ADMIN', ids.users.admin],
    ['RECRUITER', ids.users.recruiter],
    ['COMPLIANCE_OFFICER', ids.users.compliance],
    ['VIEWER', ids.users.shared],
  ])('%s may read expiring documents', async (_role, userId) => {
    const response = await expiringRequest(userId, ids.tenants.zauroh);

    expect(response.status).toBe(200);
    expect(response.body.pagination.totalItems).toBe(5);
  });
});

describe('GET /api/v1/documents/expiring business window', () => {
  it('includes today, day 1, day 29, and day 30 inclusively', async () => {
    const response = await expiringRequest(
      ids.users.admin,
      ids.tenants.zauroh,
    ).query({ pageSize: 100 });
    const returnedIds = response.body.items.map(
      (document: { id: string }) => document.id,
    );

    expect(returnedIds).toEqual(
      expect.arrayContaining([
        ids.documents.today,
        ids.documents.dayOne,
        ids.documents.dayTwentyNine,
        ids.documents.dayThirty,
      ]),
    );
  });

  it('excludes yesterday, day 31, and null expiry dates', async () => {
    const response = await expiringRequest(
      ids.users.admin,
      ids.tenants.zauroh,
    ).query({ pageSize: 100 });
    const returnedIds = response.body.items.map(
      (document: { id: string }) => document.id,
    );

    expect(returnedIds).not.toEqual(
      expect.arrayContaining([
        ids.documents.yesterday,
        ids.documents.dayThirtyOne,
        ids.documents.nullExpiry,
      ]),
    );
  });

  it('excludes an old expiring version when the current version is outside the window', async () => {
    const response = await expiringRequest(
      ids.users.admin,
      ids.tenants.zauroh,
    ).query({ pageSize: 100 });

    expect(
      response.body.items.some(
        (document: { id: string }) =>
          document.id === ids.documents.oldSoonCurrentFuture,
      ),
    ).toBe(false);
  });

  it('includes an expiring current version when the older version is outside the window', async () => {
    const response = await expiringRequest(
      ids.users.admin,
      ids.tenants.zauroh,
    ).query({ pageSize: 100 });
    const document = response.body.items.find(
      (item: { id: string }) => item.id === ids.documents.oldFutureCurrentSoon,
    );

    expect(document.currentVersion).toMatchObject({
      versionNumber: 2,
      expiryDate: '2026-08-16',
    });
  });

  it('orders nearest expiry first with deterministic document IDs as the tie-breaker', async () => {
    const response = await expiringRequest(
      ids.users.admin,
      ids.tenants.zauroh,
    ).query({ pageSize: 100 });

    expect(
      response.body.items.map((document: { id: string }) => document.id),
    ).toEqual([
      ids.documents.today,
      ids.documents.dayOne,
      ids.documents.oldFutureCurrentSoon,
      ids.documents.dayTwentyNine,
      ids.documents.dayThirty,
    ]);
  });

  it('uses the existing bounded pagination envelope', async () => {
    const firstPage = await expiringRequest(
      ids.users.admin,
      ids.tenants.zauroh,
    ).query({ page: 1, pageSize: 2 });
    const secondPage = await expiringRequest(
      ids.users.admin,
      ids.tenants.zauroh,
    ).query({ page: 2, pageSize: 2 });

    expect(firstPage.body.pagination).toEqual({
      page: 1,
      pageSize: 2,
      totalItems: 5,
      totalPages: 3,
    });
    expect(firstPage.body.items).toHaveLength(2);
    expect(secondPage.body.items).toHaveLength(2);
    expect(secondPage.body.items[0].id).toBe(
      ids.documents.oldFutureCurrentSoon,
    );
  });

  it('applies type and status filters to the document and current version', async () => {
    const typeFiltered = await expiringRequest(
      ids.users.admin,
      ids.tenants.zauroh,
    ).query({ type: 'OTHER' });
    const statusFiltered = await expiringRequest(
      ids.users.admin,
      ids.tenants.zauroh,
    ).query({ status: 'PENDING_REVIEW' });

    expect(typeFiltered.body.items).toHaveLength(1);
    expect(typeFiltered.body.items[0].id).toBe(ids.documents.dayOne);
    expect(statusFiltered.body.items).toHaveLength(1);
    expect(statusFiltered.body.items[0].id).toBe(ids.documents.dayTwentyNine);
  });

  it('never returns another tenant document', async () => {
    const response = await expiringRequest(
      ids.users.admin,
      ids.tenants.zauroh,
    ).query({ pageSize: 100 });

    expect(
      response.body.items.some(
        (document: { id: string }) =>
          document.id === ids.documents.khaleelDayOne,
      ),
    ).toBe(false);
  });

  it('returns only Khaleel results under the Khaleel membership context', async () => {
    const response = await expiringRequest(
      ids.users.shared,
      ids.tenants.khaleel,
    );

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].id).toBe(ids.documents.khaleelDayOne);
  });

  it('rejects invalid pagination and filter values', async () => {
    const [page, pageSize, type, status] = await Promise.all([
      expiringRequest(ids.users.admin, ids.tenants.zauroh).query({ page: 0 }),
      expiringRequest(ids.users.admin, ids.tenants.zauroh).query({
        pageSize: 101,
      }),
      expiringRequest(ids.users.admin, ids.tenants.zauroh).query({
        type: 'VENDOR_TYPE',
      }),
      expiringRequest(ids.users.admin, ids.tenants.zauroh).query({
        status: 'EXPIRED',
      }),
    ]);

    expect([page.status, pageSize.status, type.status, status.status]).toEqual([
      400, 400, 400, 400,
    ]);
  });

  it('returns 200 with an empty pagination envelope when nothing matches', async () => {
    const response = await expiringRequest(
      ids.users.admin,
      ids.tenants.zauroh,
    ).query({ type: 'BACKGROUND_CHECK' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      items: [],
      pagination: {
        page: 1,
        pageSize: 20,
        totalItems: 0,
        totalPages: 0,
      },
    });
  });

  it('returns the existing DTO without tenant ownership fields', async () => {
    const response = await expiringRequest(
      ids.users.admin,
      ids.tenants.zauroh,
    ).query({ pageSize: 1 });

    expect(response.body.items[0]).not.toHaveProperty('tenantId');
    expect(response.body.items[0].currentVersion).not.toHaveProperty(
      'tenantId',
    );
  });
});

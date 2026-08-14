import type {
  CreateComplianceDocumentRequest,
  TenantContext,
} from '@candidate-compliance/contracts';
import { PrismaClient, TenantRole } from '@prisma/client';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { loadEnvironment } from '../../config/load-environment.js';
import {
  addComplianceDocumentVersion,
  createComplianceDocument,
} from './compliance-document.service.js';

loadEnvironment();

const runtimePrisma = new PrismaClient();
const adminPrisma = new PrismaClient({
  datasourceUrl: process.env.DIRECT_DATABASE_URL,
});
const jwtConfig = {
  secret: 'compliance-document-integration-test-secret',
  expiresIn: '15m' as const,
};
const app = createApp({ prisma: runtimePrisma, jwtConfig });
let idempotencySequence = 0;

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
    zaurohRecruiter: '30000000-0000-4000-8000-000000000002',
    zaurohCompliance: '30000000-0000-4000-8000-000000000003',
    zaurohViewer: '30000000-0000-4000-8000-000000000004',
  },
  candidates: {
    zaurohTest: '41000000-0000-4000-8000-000000000001',
    khaleelTest: '41000000-0000-4000-8000-000000000002',
  },
  documents: {
    zaurohSeed: '50000000-0000-4000-8000-000000000001',
    khaleelSeed: '50000000-0000-4000-8000-000000000002',
    nonexistent: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  },
} as const;

const zaurohAdminContext: TenantContext = {
  tenantId: ids.tenants.zauroh,
  userId: ids.users.admin,
  membershipId: ids.memberships.zaurohAdmin,
  role: TenantRole.ADMIN,
};

const forbiddenProblem = {
  type: 'about:blank',
  title: 'Forbidden',
  status: 403,
  detail: 'You do not have permission to perform this operation.',
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

function tokenFor(userId: string): string {
  return jwt.sign({}, jwtConfig.secret, {
    algorithm: 'HS256',
    expiresIn: jwtConfig.expiresIn,
    subject: userId,
  });
}

function documentInput(
  type: CreateComplianceDocumentRequest['type'] = 'RIGHT_TO_WORK',
): CreateComplianceDocumentRequest {
  return {
    type,
    issueDate: '2026-08-01',
    expiryDate: '2027-08-01',
  };
}

function nextIdempotencyKey(): string {
  idempotencySequence += 1;
  return `phase2b-document-${idempotencySequence}`;
}

function createDocumentRequest(
  userId: string,
  tenantId: string,
  candidateId: string = ids.candidates.zaurohTest,
  idempotencyKey: string | null = nextIdempotencyKey(),
) {
  const pendingRequest = request(app)
    .post(`/api/v1/candidates/${candidateId}/documents`)
    .set('Authorization', `Bearer ${tokenFor(userId)}`)
    .set('X-Tenant-Id', tenantId);

  if (idempotencyKey !== null) {
    pendingRequest.set('Idempotency-Key', idempotencyKey);
  }

  return pendingRequest;
}

function listDocumentsRequest(
  userId: string,
  tenantId: string,
  candidateId: string = ids.candidates.zaurohTest,
) {
  return request(app)
    .get(`/api/v1/candidates/${candidateId}/documents`)
    .set('Authorization', `Bearer ${tokenFor(userId)}`)
    .set('X-Tenant-Id', tenantId);
}

function getDocumentRequest(
  userId: string,
  tenantId: string,
  documentId: string,
) {
  return request(app)
    .get(`/api/v1/documents/${documentId}`)
    .set('Authorization', `Bearer ${tokenFor(userId)}`)
    .set('X-Tenant-Id', tenantId);
}

function addVersionRequest(
  userId: string,
  tenantId: string,
  documentId: string,
  idempotencyKey: string | null = nextIdempotencyKey(),
) {
  const pendingRequest = request(app)
    .post(`/api/v1/documents/${documentId}/versions`)
    .set('Authorization', `Bearer ${tokenFor(userId)}`)
    .set('X-Tenant-Id', tenantId);

  if (idempotencyKey !== null) {
    pendingRequest.set('Idempotency-Key', idempotencyKey);
  }

  return pendingRequest;
}

async function cleanTestDocuments(): Promise<void> {
  await adminPrisma.idempotencyRecord.deleteMany({
    where: { key: { startsWith: 'phase2b-document-' } },
  });
  const documents = await adminPrisma.complianceDocument.findMany({
    where: {
      candidateId: {
        in: [ids.candidates.zaurohTest, ids.candidates.khaleelTest],
      },
    },
    select: { id: true },
  });
  const documentIds = documents.map((document) => document.id);

  if (documentIds.length === 0) {
    return;
  }

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

async function createDocumentAs(
  userId: string = ids.users.admin,
  candidateId: string = ids.candidates.zaurohTest,
) {
  return createDocumentRequest(userId, ids.tenants.zauroh, candidateId).send(
    documentInput(),
  );
}

beforeAll(async () => {
  const memberships = await adminPrisma.tenantMembership.count({
    where: {
      id: {
        in: [
          ids.memberships.zaurohAdmin,
          ids.memberships.zaurohRecruiter,
          ids.memberships.zaurohCompliance,
          ids.memberships.zaurohViewer,
        ],
      },
    },
  });

  if (memberships !== 4) {
    throw new Error('Run pnpm db:seed before ComplianceDocument API tests.');
  }

  await adminPrisma.candidate.upsert({
    where: { id: ids.candidates.zaurohTest },
    create: {
      id: ids.candidates.zaurohTest,
      tenantId: ids.tenants.zauroh,
      fullName: 'Phase 2B Zauroh Candidate',
      email: 'zauroh.document.fixture@phase2b.test',
      roleAppliedFor: 'Phase Two B Fixture',
    },
    update: {},
  });
  await adminPrisma.candidate.upsert({
    where: { id: ids.candidates.khaleelTest },
    create: {
      id: ids.candidates.khaleelTest,
      tenantId: ids.tenants.khaleel,
      fullName: 'Phase 2B Khaleel Candidate',
      email: 'khaleel.document.fixture@phase2b.test',
      roleAppliedFor: 'Phase Two B Fixture',
    },
    update: {},
  });
  await cleanTestDocuments();
});

beforeEach(async () => {
  await cleanTestDocuments();
});

afterAll(async () => {
  await cleanTestDocuments();
  await adminPrisma.candidate.deleteMany({
    where: {
      id: {
        in: [ids.candidates.zaurohTest, ids.candidates.khaleelTest],
      },
    },
  });
  await Promise.all([runtimePrisma.$disconnect(), adminPrisma.$disconnect()]);
});

describe('POST /api/v1/candidates/:candidateId/documents', () => {
  it('fails authentication before tenant context and authorisation', async () => {
    const response = await request(app)
      .post(`/api/v1/candidates/${ids.candidates.zaurohTest}/documents`)
      .set('X-Tenant-Id', ids.tenants.zauroh)
      .send(documentInput());

    expect(response.status).toBe(401);
  });

  it('requires validated tenant context before authorisation', async () => {
    const response = await request(app)
      .post(`/api/v1/candidates/${ids.candidates.zaurohTest}/documents`)
      .set('Authorization', `Bearer ${tokenFor(ids.users.admin)}`)
      .send(documentInput());

    expect(response.status).toBe(400);
  });

  it.each([
    ['ADMIN', ids.users.admin],
    ['RECRUITER', ids.users.recruiter],
    ['COMPLIANCE_OFFICER', ids.users.compliance],
  ])(
    '%s may create a logical document and version 1',
    async (_role, userId) => {
      const response = await createDocumentAs(userId);

      expect(response.status).toBe(201);
      expect(response.body.type).toBe('RIGHT_TO_WORK');
      expect(response.body.currentVersion).toMatchObject({
        versionNumber: 1,
        issueDate: '2026-08-01',
        expiryDate: '2027-08-01',
        status: 'DRAFT',
      });
    },
  );

  it('denies VIEWER document creation', async () => {
    const response = await createDocumentAs(ids.users.shared);

    expect(response.status).toBe(403);
    expect(response.body).toEqual(forbiddenProblem);
  });

  it('returns identical 404 semantics for a cross-tenant candidate', async () => {
    const response = await createDocumentRequest(
      ids.users.admin,
      ids.tenants.zauroh,
      ids.candidates.khaleelTest,
    ).send(documentInput());

    expect(response.status).toBe(404);
    expect(response.body).toEqual(candidateNotFoundProblem);
  });

  it('rejects a malformed candidate UUID', async () => {
    const response = await createDocumentRequest(
      ids.users.admin,
      ids.tenants.zauroh,
      'not-a-uuid',
    ).send(documentInput());

    expect(response.status).toBe(400);
  });

  it.each([
    'tenantId',
    'documentId',
    'candidateId',
    'versionNumber',
    'currentVersionId',
    'createdBy',
    'supersedesVersionId',
    'status',
  ])('rejects client-controlled %s', async (field) => {
    const response = await createDocumentRequest(
      ids.users.admin,
      ids.tenants.zauroh,
    ).send({
      ...documentInput('OTHER'),
      [field]: 'client-controlled',
    });

    expect(response.status).toBe(400);
  });

  it('rejects an expiry date earlier than the issue date', async () => {
    const response = await createDocumentRequest(
      ids.users.admin,
      ids.tenants.zauroh,
    ).send({
      type: 'RIGHT_TO_WORK',
      issueDate: '2027-08-01',
      expiryDate: '2026-08-01',
    });

    expect(response.status).toBe(400);
    expect(response.body.errors).toContainEqual({
      path: 'expiryDate',
      message: 'Expiry date must not be earlier than issue date.',
    });
  });

  it('creates the logical document, version, pointer, and membership provenance atomically', async () => {
    const response = await createDocumentAs(ids.users.compliance);
    const stored = await adminPrisma.complianceDocument.findUnique({
      where: { id: response.body.id },
      include: { versions: true },
    });

    expect(response.status).toBe(201);
    expect(stored?.versions).toHaveLength(1);
    expect(stored?.currentVersionId).toBe(stored?.versions[0]?.id);
    expect(stored?.versions[0]?.createdBy).toBe(
      ids.memberships.zaurohCompliance,
    );
    expect(stored?.versions[0]?.supersedesVersionId).toBeNull();
  });

  it('rolls back the logical document when initial version creation fails', async () => {
    const before = await adminPrisma.complianceDocument.count({
      where: { candidateId: ids.candidates.zaurohTest },
    });

    await expect(
      createComplianceDocument(
        runtimePrisma,
        {
          ...zaurohAdminContext,
          membershipId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        },
        ids.candidates.zaurohTest,
        documentInput(),
        nextIdempotencyKey(),
      ),
    ).rejects.toMatchObject({ code: 'P2003' });

    await expect(
      adminPrisma.complianceDocument.count({
        where: { candidateId: ids.candidates.zaurohTest },
      }),
    ).resolves.toBe(before);
  });
});

describe('GET /api/v1/candidates/:candidateId/documents', () => {
  it('returns only same-tenant documents with deterministic pagination', async () => {
    await createDocumentRequest(ids.users.admin, ids.tenants.zauroh).send(
      documentInput('RIGHT_TO_WORK'),
    );
    await createDocumentRequest(ids.users.admin, ids.tenants.zauroh).send(
      documentInput('BACKGROUND_CHECK'),
    );
    await createDocumentRequest(
      ids.users.shared,
      ids.tenants.khaleel,
      ids.candidates.khaleelTest,
    ).send(documentInput('OTHER'));

    const firstPage = await listDocumentsRequest(
      ids.users.admin,
      ids.tenants.zauroh,
    ).query({ page: 1, pageSize: 1 });
    const secondPage = await listDocumentsRequest(
      ids.users.admin,
      ids.tenants.zauroh,
    ).query({ page: 2, pageSize: 1 });

    expect(firstPage.status).toBe(200);
    expect(firstPage.body.pagination).toEqual({
      page: 1,
      pageSize: 1,
      totalItems: 2,
      totalPages: 2,
    });
    expect(secondPage.body.items).toHaveLength(1);
    expect(secondPage.body.items[0].id).not.toBe(firstPage.body.items[0].id);
    expect(
      [...firstPage.body.items, ...secondPage.body.items].every(
        (document) => document.candidateId === ids.candidates.zaurohTest,
      ),
    ).toBe(true);
  });

  it('supports type and current-status filters', async () => {
    await createDocumentRequest(ids.users.admin, ids.tenants.zauroh).send(
      documentInput('RIGHT_TO_WORK'),
    );
    await createDocumentRequest(ids.users.admin, ids.tenants.zauroh).send(
      documentInput('OTHER'),
    );

    const filtered = await listDocumentsRequest(
      ids.users.admin,
      ids.tenants.zauroh,
    ).query({ type: 'OTHER', status: 'DRAFT' });
    const excluded = await listDocumentsRequest(
      ids.users.admin,
      ids.tenants.zauroh,
    ).query({ status: 'APPROVED' });

    expect(filtered.status).toBe(200);
    expect(filtered.body.items).toHaveLength(1);
    expect(filtered.body.items[0].type).toBe('OTHER');
    expect(excluded.body.items).toEqual([]);
  });

  it('allows a VIEWER to read candidate documents', async () => {
    await createDocumentAs();

    const response = await listDocumentsRequest(
      ids.users.shared,
      ids.tenants.zauroh,
    );

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
  });

  it('returns 404 for a cross-tenant candidate without exposing documents', async () => {
    await createDocumentRequest(
      ids.users.shared,
      ids.tenants.khaleel,
      ids.candidates.khaleelTest,
    ).send(documentInput());

    const response = await listDocumentsRequest(
      ids.users.admin,
      ids.tenants.zauroh,
      ids.candidates.khaleelTest,
    );

    expect(response.status).toBe(404);
    expect(response.body).toEqual(candidateNotFoundProblem);
  });
});

describe('GET /api/v1/documents/:documentId', () => {
  it('returns the current version and omits ownership and creator fields', async () => {
    const created = await createDocumentAs();
    const response = await getDocumentRequest(
      ids.users.shared,
      ids.tenants.zauroh,
      created.body.id,
    );

    expect(response.status).toBe(200);
    expect(response.body.currentVersion.versionNumber).toBe(1);
    expect(response.body).not.toHaveProperty('tenantId');
    expect(response.body).not.toHaveProperty('currentVersionId');
    expect(response.body.currentVersion).not.toHaveProperty('tenantId');
    expect(response.body.currentVersion).not.toHaveProperty('createdBy');
    expect(response.body.currentVersion).not.toHaveProperty(
      'supersedesVersionId',
    );
  });

  it('gives cross-tenant and nonexistent document IDs identical 404 responses', async () => {
    const crossTenant = await getDocumentRequest(
      ids.users.admin,
      ids.tenants.zauroh,
      ids.documents.khaleelSeed,
    );
    const nonexistent = await getDocumentRequest(
      ids.users.admin,
      ids.tenants.zauroh,
      ids.documents.nonexistent,
    );

    expect(crossTenant.status).toBe(404);
    expect(nonexistent.status).toBe(404);
    expect(crossTenant.body).toEqual(documentNotFoundProblem);
    expect(nonexistent.body).toEqual(documentNotFoundProblem);
  });

  it('rejects a malformed document UUID', async () => {
    const response = await getDocumentRequest(
      ids.users.admin,
      ids.tenants.zauroh,
      'not-a-uuid',
    );

    expect(response.status).toBe(400);
  });
});

describe('POST /api/v1/documents/:documentId/versions', () => {
  it('creates a sequential DRAFT version and updates the current pointer', async () => {
    const created = await createDocumentAs(ids.users.recruiter);
    const response = await addVersionRequest(
      ids.users.compliance,
      ids.tenants.zauroh,
      created.body.id,
    ).send({ issueDate: '2026-09-01', expiryDate: '2027-09-01' });
    const stored = await adminPrisma.complianceDocument.findUnique({
      where: { id: created.body.id },
      include: { versions: { orderBy: { versionNumber: 'asc' } } },
    });

    expect(response.status).toBe(201);
    expect(response.body.currentVersion).toMatchObject({
      versionNumber: 2,
      status: 'DRAFT',
      issueDate: '2026-09-01',
      expiryDate: '2027-09-01',
    });
    expect(stored?.versions).toHaveLength(2);
    expect(stored?.versions.map((version) => version.versionNumber)).toEqual([
      1, 2,
    ]);
    expect(stored?.currentVersionId).toBe(stored?.versions[1]?.id);
    expect(stored?.versions[1]?.createdBy).toBe(
      ids.memberships.zaurohCompliance,
    );
    expect(stored?.versions[1]?.supersedesVersionId).toBe(
      stored?.versions[0]?.id,
    );
  });

  it('denies a VIEWER from adding a version', async () => {
    const created = await createDocumentAs();
    const response = await addVersionRequest(
      ids.users.shared,
      ids.tenants.zauroh,
      created.body.id,
    ).send({});

    expect(response.status).toBe(403);
    expect(response.body).toEqual(forbiddenProblem);
  });

  it.each(['tenantId', 'versionNumber', 'createdBy', 'status'])(
    'rejects client-controlled version %s',
    async (field) => {
      const created = await createDocumentAs();
      const response = await addVersionRequest(
        ids.users.admin,
        ids.tenants.zauroh,
        created.body.id,
      ).send({ [field]: 'client-controlled' });

      expect(response.status).toBe(400);
    },
  );

  it('returns 404 for a cross-tenant document', async () => {
    const response = await addVersionRequest(
      ids.users.admin,
      ids.tenants.zauroh,
      ids.documents.khaleelSeed,
    ).send({});

    expect(response.status).toBe(404);
    expect(response.body).toEqual(documentNotFoundProblem);
  });

  it('rolls back a failed version operation and leaves the pointer unchanged', async () => {
    const created = await createDocumentAs();
    const before = await adminPrisma.complianceDocument.findUnique({
      where: { id: created.body.id },
      include: { versions: true },
    });

    await expect(
      addComplianceDocumentVersion(
        runtimePrisma,
        {
          ...zaurohAdminContext,
          membershipId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        },
        created.body.id,
        {},
        nextIdempotencyKey(),
      ),
    ).rejects.toMatchObject({ code: 'P2003' });

    const after = await adminPrisma.complianceDocument.findUnique({
      where: { id: created.body.id },
      include: { versions: true },
    });
    expect(after?.versions).toHaveLength(1);
    expect(after?.currentVersionId).toBe(before?.currentVersionId);
  });

  it('handles concurrent version numbering without duplicate versions or 500 responses', async () => {
    const created = await createDocumentAs();
    const responses = await Promise.all([
      addVersionRequest(
        ids.users.admin,
        ids.tenants.zauroh,
        created.body.id,
      ).send({ issueDate: '2026-09-01' }),
      addVersionRequest(
        ids.users.admin,
        ids.tenants.zauroh,
        created.body.id,
      ).send({ issueDate: '2026-10-01' }),
    ]);

    expect(
      responses.every((response) => [201, 409].includes(response.status)),
    ).toBe(true);
    expect(responses.some((response) => response.status === 201)).toBe(true);
    for (const response of responses.filter(
      (candidate) => candidate.status === 409,
    )) {
      expect(response.body).toEqual({
        type: 'about:blank',
        title: 'Conflict',
        status: 409,
        detail:
          'A document version was created concurrently. Retry the request.',
      });
    }

    const stored = await adminPrisma.complianceDocument.findUnique({
      where: { id: created.body.id },
      include: { versions: { orderBy: { versionNumber: 'asc' } } },
    });
    const versionNumbers = stored?.versions.map(
      (version) => version.versionNumber,
    );
    expect(versionNumbers).toEqual(
      Array.from(
        { length: versionNumbers?.length ?? 0 },
        (_, index) => index + 1,
      ),
    );
    expect(stored?.currentVersionId).toBe(stored?.versions.at(-1)?.id);
  });
});

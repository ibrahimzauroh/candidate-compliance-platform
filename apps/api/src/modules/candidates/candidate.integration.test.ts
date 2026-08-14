import { PrismaClient } from '@prisma/client';
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
  secret: 'candidate-api-integration-test-secret-value',
  expiresIn: '15m' as const,
};
const app = createApp({ prisma: runtimePrisma, jwtConfig });

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
  candidates: {
    zaurohAlex: '40000000-0000-4000-8000-000000000001',
    khaleelAlex: '40000000-0000-4000-8000-000000000003',
    nonexistent: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  },
} as const;

const authenticationRequiredProblem = {
  type: 'about:blank',
  title: 'Unauthorized',
  status: 401,
  detail: 'A valid Bearer access token is required.',
};

const tenantHeaderRequiredProblem = {
  type: 'about:blank',
  title: 'Bad Request',
  status: 400,
  detail: 'X-Tenant-Id header is required.',
};

const tenantContextForbiddenProblem = {
  type: 'about:blank',
  title: 'Forbidden',
  status: 403,
  detail: 'Tenant context is not available for this user.',
};

const permissionForbiddenProblem = {
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

const candidateEmailConflictProblem = {
  type: 'about:blank',
  title: 'Conflict',
  status: 409,
  detail: 'A candidate with this email already exists in this tenant.',
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
    email: `${name.toLowerCase()}@phase2a.test`,
    roleAppliedFor: 'Phase 2A Engineer',
  };
}

function createRequest(userId?: string, tenantId?: string) {
  const pendingRequest = request(app).post('/api/v1/candidates');

  if (userId) {
    pendingRequest.set('Authorization', `Bearer ${tokenFor(userId)}`);
  }
  if (tenantId) {
    pendingRequest.set('X-Tenant-Id', tenantId);
  }

  return pendingRequest;
}

function listRequest(userId: string, tenantId: string) {
  return request(app)
    .get('/api/v1/candidates')
    .set('Authorization', `Bearer ${tokenFor(userId)}`)
    .set('X-Tenant-Id', tenantId);
}

function getRequest(userId: string, tenantId: string, candidateId: string) {
  return request(app)
    .get(`/api/v1/candidates/${candidateId}`)
    .set('Authorization', `Bearer ${tokenFor(userId)}`)
    .set('X-Tenant-Id', tenantId);
}

function updateRequest(userId: string, tenantId: string, candidateId: string) {
  return request(app)
    .patch(`/api/v1/candidates/${candidateId}`)
    .set('Authorization', `Bearer ${tokenFor(userId)}`)
    .set('X-Tenant-Id', tenantId);
}

async function createCandidateAs(
  userId: string,
  tenantId: string,
  name: string,
) {
  return createRequest(userId, tenantId).send(candidateInput(name));
}

async function cleanTestCandidates(): Promise<void> {
  await adminPrisma.candidate.deleteMany({
    where: { email: { endsWith: '@phase2a.test' } },
  });
}

beforeAll(async () => {
  const seededCandidates = await adminPrisma.candidate.count({
    where: {
      id: {
        in: [ids.candidates.zaurohAlex, ids.candidates.khaleelAlex],
      },
    },
  });

  if (seededCandidates !== 2) {
    throw new Error('Run pnpm db:seed before Candidate API tests.');
  }

  await cleanTestCandidates();
});

beforeEach(async () => {
  await cleanTestCandidates();
});

afterAll(async () => {
  await cleanTestCandidates();
  await Promise.all([runtimePrisma.$disconnect(), adminPrisma.$disconnect()]);
});

describe('Candidate API security boundary', () => {
  it('rejects an unauthenticated create before tenant and permission checks', async () => {
    const response = await createRequest(undefined, ids.tenants.zauroh).send(
      candidateInput('Unauthenticated'),
    );

    expect(response.status).toBe(401);
    expect(response.body).toEqual(authenticationRequiredProblem);
  });

  it('rejects an authenticated create without tenant context', async () => {
    const response = await createRequest(ids.users.admin).send(
      candidateInput('MissingTenant'),
    );

    expect(response.status).toBe(400);
    expect(response.body).toEqual(tenantHeaderRequiredProblem);
  });

  it('rejects an authenticated non-member before candidate access', async () => {
    const response = await createRequest(
      ids.users.admin,
      ids.tenants.khaleel,
    ).send(candidateInput('NonMember'));

    expect(response.status).toBe(403);
    expect(response.body).toEqual(tenantContextForbiddenProblem);
  });

  it.each([
    ['ADMIN', ids.users.admin],
    ['RECRUITER', ids.users.recruiter],
  ])('allows %s to create and update candidates', async (_role, userId) => {
    const created = await createCandidateAs(
      userId,
      ids.tenants.zauroh,
      `Allowed${_role}`,
    );
    const updated = await updateRequest(
      userId,
      ids.tenants.zauroh,
      created.body.id,
    ).send({ roleAppliedFor: `${_role} Updated Role` });

    expect(created.status).toBe(201);
    expect(updated.status).toBe(200);
    expect(updated.body.roleAppliedFor).toBe(`${_role} Updated Role`);
  });

  it.each([
    ['COMPLIANCE_OFFICER', ids.users.compliance],
    ['VIEWER', ids.users.shared],
  ])('forbids %s from candidate writes', async (_role, userId) => {
    const create = await createRequest(userId, ids.tenants.zauroh).send(
      candidateInput(`Denied${_role}`),
    );
    const update = await updateRequest(
      userId,
      ids.tenants.zauroh,
      ids.candidates.zaurohAlex,
    ).send({ fullName: 'Denied Update' });

    expect(create.status).toBe(403);
    expect(create.body).toEqual(permissionForbiddenProblem);
    expect(update.status).toBe(403);
    expect(update.body).toEqual(permissionForbiddenProblem);
  });

  it.each([
    ['ADMIN', ids.users.admin],
    ['RECRUITER', ids.users.recruiter],
    ['COMPLIANCE_OFFICER', ids.users.compliance],
    ['VIEWER', ids.users.shared],
  ])('allows %s to read candidates', async (_role, userId) => {
    const response = await listRequest(userId, ids.tenants.zauroh);

    expect(response.status).toBe(200);
    expect(response.body.items.length).toBeGreaterThan(0);
  });

  it('changes shared-user write access with the validated tenant role', async () => {
    const zauroh = await createRequest(
      ids.users.shared,
      ids.tenants.zauroh,
    ).send(candidateInput('SharedZauroh'));
    const khaleel = await createRequest(
      ids.users.shared,
      ids.tenants.khaleel,
    ).send(candidateInput('SharedKhaleel'));

    expect(zauroh.status).toBe(403);
    expect(zauroh.body).toEqual(permissionForbiddenProblem);
    expect(khaleel.status).toBe(201);

    const stored = await adminPrisma.candidate.findUniqueOrThrow({
      where: { id: khaleel.body.id },
    });
    expect(stored.tenantId).toBe(ids.tenants.khaleel);
  });
});

describe('POST /api/v1/candidates', () => {
  it('creates a normalised candidate owned by the validated tenant', async () => {
    const response = await createRequest(
      ids.users.admin,
      ids.tenants.zauroh,
    ).send({
      fullName: '  New Candidate  ',
      email: '  New.Candidate@Phase2A.Test  ',
      roleAppliedFor: '  Platform Engineer  ',
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      fullName: 'New Candidate',
      email: 'new.candidate@phase2a.test',
      roleAppliedFor: 'Platform Engineer',
    });
    expect(response.body).not.toHaveProperty('tenantId');
    expect(response.body.createdAt).toEqual(expect.any(String));
    expect(response.body.updatedAt).toEqual(expect.any(String));

    const stored = await adminPrisma.candidate.findUniqueOrThrow({
      where: { id: response.body.id },
    });
    expect(stored.tenantId).toBe(ids.tenants.zauroh);
  });

  it('returns validation Problem Details for invalid candidate input', async () => {
    const response = await createRequest(
      ids.users.admin,
      ids.tenants.zauroh,
    ).send({ fullName: '', email: 'invalid', roleAppliedFor: '' });

    expect(response.status).toBe(400);
    expect(response.type).toBe('application/problem+json');
    expect(response.body).toMatchObject({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'The request data is invalid.',
    });
  });

  it('rejects client-controlled tenant ownership without creating a row', async () => {
    const input = {
      ...candidateInput('TenantManipulation'),
      tenantId: ids.tenants.khaleel,
    };
    const response = await createRequest(
      ids.users.admin,
      ids.tenants.zauroh,
    ).send(input);

    expect(response.status).toBe(400);
    await expect(
      adminPrisma.candidate.count({ where: { email: input.email } }),
    ).resolves.toBe(0);
  });

  it('returns 409 for a case-insensitive duplicate email in one tenant', async () => {
    const first = await createCandidateAs(
      ids.users.admin,
      ids.tenants.zauroh,
      'Duplicate',
    );
    const duplicate = await createRequest(
      ids.users.admin,
      ids.tenants.zauroh,
    ).send({
      ...candidateInput('DuplicateAgain'),
      email: 'DUPLICATE@PHASE2A.TEST',
    });

    expect(first.status).toBe(201);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toEqual(candidateEmailConflictProblem);
  });

  it('allows the same candidate email in different tenants', async () => {
    const email = 'tenant.unique@phase2a.test';
    const zauroh = await createRequest(
      ids.users.admin,
      ids.tenants.zauroh,
    ).send({ ...candidateInput('TenantUniqueZauroh'), email });
    const khaleel = await createRequest(
      ids.users.shared,
      ids.tenants.khaleel,
    ).send({ ...candidateInput('TenantUniqueKhaleel'), email });

    expect(zauroh.status).toBe(201);
    expect(khaleel.status).toBe(201);

    const zaurohList = await listRequest(
      ids.users.admin,
      ids.tenants.zauroh,
    ).query({ email });
    const khaleelList = await listRequest(
      ids.users.shared,
      ids.tenants.khaleel,
    ).query({ email });

    expect(zaurohList.body.items).toHaveLength(1);
    expect(zaurohList.body.items[0].id).toBe(zauroh.body.id);
    expect(khaleelList.body.items).toHaveLength(1);
    expect(khaleelList.body.items[0].id).toBe(khaleel.body.id);
  });
});

describe('GET /api/v1/candidates', () => {
  it('paginates deterministically with bounded metadata', async () => {
    for (const name of ['PaginationOne', 'PaginationTwo', 'PaginationThree']) {
      const created = await createRequest(
        ids.users.admin,
        ids.tenants.zauroh,
      ).send({
        ...candidateInput(name),
        roleAppliedFor: 'Unique Pagination Role',
      });
      expect(created.status).toBe(201);
    }

    const pageOne = await listRequest(
      ids.users.admin,
      ids.tenants.zauroh,
    ).query({ page: 1, pageSize: 2, roleAppliedFor: 'pagination' });
    const pageOneReplay = await listRequest(
      ids.users.admin,
      ids.tenants.zauroh,
    ).query({ page: 1, pageSize: 2, roleAppliedFor: 'pagination' });
    const pageTwo = await listRequest(
      ids.users.admin,
      ids.tenants.zauroh,
    ).query({ page: 2, pageSize: 2, roleAppliedFor: 'pagination' });

    expect(pageOne.status).toBe(200);
    expect(pageOne.body.pagination).toEqual({
      page: 1,
      pageSize: 2,
      totalItems: 3,
      totalPages: 2,
    });
    expect(pageOne.body.items).toHaveLength(2);
    expect(pageOneReplay.body.items).toEqual(pageOne.body.items);
    expect(pageTwo.body.items).toHaveLength(1);
    expect(
      new Set(
        [...pageOne.body.items, ...pageTwo.body.items].map(
          (candidate) => candidate.id,
        ),
      ).size,
    ).toBe(3);
  });

  it('supports case-insensitive search across candidate fields', async () => {
    await createRequest(ids.users.admin, ids.tenants.zauroh).send({
      ...candidateInput('Searchable'),
      fullName: 'Distinctive Search Name',
    });
    await createCandidateAs(ids.users.admin, ids.tenants.zauroh, 'Unrelated');

    const response = await listRequest(
      ids.users.admin,
      ids.tenants.zauroh,
    ).query({ search: 'distinctive SEARCH' });

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].fullName).toBe('Distinctive Search Name');
  });

  it('supports exact email and partial role filters', async () => {
    const created = await createRequest(
      ids.users.admin,
      ids.tenants.zauroh,
    ).send({
      ...candidateInput('Filtered'),
      roleAppliedFor: 'Senior Compliance Engineer',
    });
    await createCandidateAs(ids.users.admin, ids.tenants.zauroh, 'Unfiltered');

    const email = await listRequest(ids.users.admin, ids.tenants.zauroh).query({
      email: 'FILTERED@PHASE2A.TEST',
    });
    const role = await listRequest(ids.users.admin, ids.tenants.zauroh).query({
      roleAppliedFor: 'compliance',
    });

    expect(email.body.items).toHaveLength(1);
    expect(email.body.items[0].id).toBe(created.body.id);
    expect(role.body.items).toHaveLength(1);
    expect(role.body.items[0].id).toBe(created.body.id);
  });

  it('rejects invalid and unrecognised pagination/filter values', async () => {
    const oversized = await listRequest(
      ids.users.admin,
      ids.tenants.zauroh,
    ).query({ pageSize: 101 });
    const unrecognised = await listRequest(
      ids.users.admin,
      ids.tenants.zauroh,
    ).query({ tenantId: ids.tenants.khaleel });

    expect(oversized.status).toBe(400);
    expect(unrecognised.status).toBe(400);
  });
});

describe('GET /api/v1/candidates/:candidateId', () => {
  it('returns a candidate from the active tenant', async () => {
    const created = await createCandidateAs(
      ids.users.admin,
      ids.tenants.zauroh,
      'GetCandidate',
    );
    const response = await getRequest(
      ids.users.compliance,
      ids.tenants.zauroh,
      created.body.id,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual(created.body);
  });

  it('returns the same 404 for cross-tenant and nonexistent candidate IDs', async () => {
    const crossTenant = await getRequest(
      ids.users.admin,
      ids.tenants.zauroh,
      ids.candidates.khaleelAlex,
    );
    const nonexistent = await getRequest(
      ids.users.admin,
      ids.tenants.zauroh,
      ids.candidates.nonexistent,
    );

    expect(crossTenant.status).toBe(404);
    expect(crossTenant.body).toEqual(candidateNotFoundProblem);
    expect(nonexistent.status).toBe(404);
    expect(nonexistent.body).toEqual(crossTenant.body);
  });

  it('rejects a malformed candidate UUID', async () => {
    const response = await getRequest(
      ids.users.admin,
      ids.tenants.zauroh,
      'not-a-uuid',
    );

    expect(response.status).toBe(400);
  });
});

describe('PATCH /api/v1/candidates/:candidateId', () => {
  it('updates only supplied fields and returns the candidate DTO', async () => {
    const created = await createCandidateAs(
      ids.users.recruiter,
      ids.tenants.zauroh,
      'UpdateCandidate',
    );
    const response = await updateRequest(
      ids.users.recruiter,
      ids.tenants.zauroh,
      created.body.id,
    ).send({
      fullName: '  Updated Candidate  ',
      roleAppliedFor: '  Updated Role  ',
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: created.body.id,
      fullName: 'Updated Candidate',
      email: created.body.email,
      roleAppliedFor: 'Updated Role',
    });
    expect(response.body).not.toHaveProperty('tenantId');
  });

  it('returns 404 without modifying a known cross-tenant candidate', async () => {
    const before = await adminPrisma.candidate.findUniqueOrThrow({
      where: { id: ids.candidates.khaleelAlex },
    });
    const response = await updateRequest(
      ids.users.admin,
      ids.tenants.zauroh,
      ids.candidates.khaleelAlex,
    ).send({ fullName: 'Cross-Tenant Update' });
    const after = await adminPrisma.candidate.findUniqueOrThrow({
      where: { id: ids.candidates.khaleelAlex },
    });

    expect(response.status).toBe(404);
    expect(response.body).toEqual(candidateNotFoundProblem);
    expect(after).toEqual(before);
  });

  it('rejects tenant ownership and empty update bodies', async () => {
    const created = await createCandidateAs(
      ids.users.admin,
      ids.tenants.zauroh,
      'InvalidUpdate',
    );
    const tenantManipulation = await updateRequest(
      ids.users.admin,
      ids.tenants.zauroh,
      created.body.id,
    ).send({ tenantId: ids.tenants.khaleel });
    const empty = await updateRequest(
      ids.users.admin,
      ids.tenants.zauroh,
      created.body.id,
    ).send({});

    expect(tenantManipulation.status).toBe(400);
    expect(empty.status).toBe(400);

    const stored = await adminPrisma.candidate.findUniqueOrThrow({
      where: { id: created.body.id },
    });
    expect(stored.tenantId).toBe(ids.tenants.zauroh);
    expect(stored.fullName).toBe(created.body.fullName);
  });

  it('returns 409 when an update conflicts with another tenant-local email', async () => {
    const first = await createCandidateAs(
      ids.users.admin,
      ids.tenants.zauroh,
      'UpdateConflictOne',
    );
    const second = await createCandidateAs(
      ids.users.admin,
      ids.tenants.zauroh,
      'UpdateConflictTwo',
    );
    const response = await updateRequest(
      ids.users.admin,
      ids.tenants.zauroh,
      second.body.id,
    ).send({ email: first.body.email.toUpperCase() });

    expect(response.status).toBe(409);
    expect(response.body).toEqual(candidateEmailConflictProblem);
  });
});

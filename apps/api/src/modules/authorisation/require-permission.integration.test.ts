import { PrismaClient } from '@prisma/client';
import express, { type RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadEnvironment } from '../../config/load-environment.js';
import { problemDetailsHandler } from '../../infrastructure/http/problem-details.js';
import { createAuthenticationMiddleware } from '../auth/authenticate.middleware.js';
import { createRequireTenantContextMiddleware } from '../tenant-context/require-tenant-context.middleware.js';
import { PERMISSIONS } from './permissions.js';
import { requirePermission } from './require-permission.middleware.js';

loadEnvironment();

const prisma = new PrismaClient();
const jwtConfig = {
  secret: 'authorisation-integration-test-secret-value',
  expiresIn: '15m' as const,
};

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

const permissionForbiddenProblem = {
  type: 'about:blank',
  title: 'Forbidden',
  status: 403,
  detail: 'You do not have permission to perform this operation.',
};

const app = express();
const authenticate = createAuthenticationMiddleware(prisma, jwtConfig);
const requireTenantContext = createRequireTenantContextMiddleware(prisma);
const testHandler: RequestHandler = (request, response) => {
  response.status(200).json({
    reached: true,
    tenantId: request.tenantContext?.tenantId,
    role: request.tenantContext?.role,
  });
};

app.use(express.json());
app.post(
  '/test/candidate-create',
  authenticate,
  requireTenantContext,
  requirePermission(PERMISSIONS.candidateCreate),
  testHandler,
);
app.get(
  '/test/candidate-read',
  authenticate,
  requireTenantContext,
  requirePermission(PERMISSIONS.candidateRead),
  testHandler,
);
app.post(
  '/test/document-approve',
  authenticate,
  requireTenantContext,
  requirePermission(PERMISSIONS.documentApprove),
  testHandler,
);
app.post(
  '/test/document-correct',
  authenticate,
  requireTenantContext,
  requirePermission(PERMISSIONS.documentCorrect),
  testHandler,
);
app.use(problemDetailsHandler);

function tokenFor(
  userId: string,
  additionalClaims: Record<string, unknown> = {},
): string {
  return jwt.sign(additionalClaims, jwtConfig.secret, {
    algorithm: 'HS256',
    expiresIn: jwtConfig.expiresIn,
    subject: userId,
  });
}

function candidateCreateRequest(token?: string, tenantId?: string) {
  const pendingRequest = request(app).post('/test/candidate-create');

  if (token) {
    pendingRequest.set('Authorization', `Bearer ${token}`);
  }

  if (tenantId) {
    pendingRequest.set('X-Tenant-Id', tenantId);
  }

  return pendingRequest;
}

function candidateReadRequest(token?: string, tenantId?: string) {
  const pendingRequest = request(app).get('/test/candidate-read');

  if (token) {
    pendingRequest.set('Authorization', `Bearer ${token}`);
  }

  if (tenantId) {
    pendingRequest.set('X-Tenant-Id', tenantId);
  }

  return pendingRequest;
}

function documentApproveRequest(token?: string, tenantId?: string) {
  const pendingRequest = request(app).post('/test/document-approve');

  if (token) {
    pendingRequest.set('Authorization', `Bearer ${token}`);
  }

  if (tenantId) {
    pendingRequest.set('X-Tenant-Id', tenantId);
  }

  return pendingRequest;
}

function documentCorrectRequest(token?: string, tenantId?: string) {
  const pendingRequest = request(app).post('/test/document-correct');

  if (token) {
    pendingRequest.set('Authorization', `Bearer ${token}`);
  }

  if (tenantId) {
    pendingRequest.set('X-Tenant-Id', tenantId);
  }

  return pendingRequest;
}

beforeAll(async () => {
  const expectedMemberships = [
    [ids.users.admin, ids.tenants.zauroh, 'ADMIN'],
    [ids.users.recruiter, ids.tenants.zauroh, 'RECRUITER'],
    [ids.users.compliance, ids.tenants.zauroh, 'COMPLIANCE_OFFICER'],
    [ids.users.shared, ids.tenants.zauroh, 'VIEWER'],
    [ids.users.shared, ids.tenants.khaleel, 'RECRUITER'],
  ] as const;
  const memberships = await Promise.all(
    expectedMemberships.map(
      ([userId, tenantId]) =>
        prisma.$queryRaw<Array<{ role: string }>>`
        SELECT role
        FROM public.validate_tenant_membership(
          ${userId}::uuid,
          ${tenantId}::uuid
        )
      `,
    ),
  );

  const fixturesMatch = memberships.every(
    (membership, index) =>
      membership.length === 1 &&
      membership[0]?.role === expectedMemberships[index]?.[2],
  );

  if (!fixturesMatch) {
    throw new Error('Run pnpm db:seed before authorisation integration tests.');
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('operation-specific authorisation middleware', () => {
  it('rejects an unauthenticated request before authorisation', async () => {
    const response = await candidateCreateRequest(
      undefined,
      ids.tenants.zauroh,
    );

    expect(response.status).toBe(401);
    expect(response.body).toEqual(authenticationRequiredProblem);
  });

  it('rejects an authenticated request without tenant context before authorisation', async () => {
    const response = await candidateCreateRequest(tokenFor(ids.users.admin));

    expect(response.status).toBe(400);
    expect(response.body).toEqual(tenantHeaderRequiredProblem);
  });

  it('returns generic 403 Problem Details for a valid membership without permission', async () => {
    const response = await candidateCreateRequest(
      tokenFor(ids.users.compliance),
      ids.tenants.zauroh,
    );

    expect(response.status).toBe(403);
    expect(response.type).toBe('application/problem+json');
    expect(response.body).toEqual(permissionForbiddenProblem);
    expect(JSON.stringify(response.body)).not.toMatch(/role|permission:/i);
  });

  it('reaches the test handler when the selected membership has permission', async () => {
    const response = await candidateReadRequest(
      tokenFor(ids.users.shared),
      ids.tenants.zauroh,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      reached: true,
      tenantId: ids.tenants.zauroh,
      role: 'VIEWER',
    });
  });

  it('authorises admin@iza.com through the normal policy for document:correct', async () => {
    const response = await documentCorrectRequest(
      tokenFor(ids.users.admin),
      ids.tenants.zauroh,
    );

    expect(response.status).toBe(200);
    expect(response.body.role).toBe('ADMIN');
  });

  it('allows recruiter@iza.com to perform candidate:create', async () => {
    const response = await candidateCreateRequest(
      tokenFor(ids.users.recruiter),
      ids.tenants.zauroh,
    );

    expect(response.status).toBe(200);
    expect(response.body.role).toBe('RECRUITER');
  });

  it('forbids recruiter@iza.com from document:approve', async () => {
    const response = await documentApproveRequest(
      tokenFor(ids.users.recruiter),
      ids.tenants.zauroh,
    );

    expect(response.status).toBe(403);
    expect(response.body).toEqual(permissionForbiddenProblem);
  });

  it('allows compliance@iza.com to perform document:approve', async () => {
    const response = await documentApproveRequest(
      tokenFor(ids.users.compliance),
      ids.tenants.zauroh,
    );

    expect(response.status).toBe(200);
    expect(response.body.role).toBe('COMPLIANCE_OFFICER');
  });

  it('forbids compliance@iza.com from candidate:create', async () => {
    const response = await candidateCreateRequest(
      tokenFor(ids.users.compliance),
      ids.tenants.zauroh,
    );

    expect(response.status).toBe(403);
    expect(response.body).toEqual(permissionForbiddenProblem);
  });

  it('uses the Zauroh VIEWER membership for shared@iza.com candidate:read', async () => {
    const response = await candidateReadRequest(
      tokenFor(ids.users.shared),
      ids.tenants.zauroh,
    );

    expect(response.status).toBe(200);
    expect(response.body.role).toBe('VIEWER');
  });

  it('forbids shared@iza.com from candidate:create in Zauroh', async () => {
    const response = await candidateCreateRequest(
      tokenFor(ids.users.shared),
      ids.tenants.zauroh,
    );

    expect(response.status).toBe(403);
    expect(response.body).toEqual(permissionForbiddenProblem);
  });

  it('uses the Khaleel RECRUITER membership for shared@iza.com candidate:create', async () => {
    const response = await candidateCreateRequest(
      tokenFor(ids.users.shared),
      ids.tenants.khaleel,
    );

    expect(response.status).toBe(200);
    expect(response.body.role).toBe('RECRUITER');
  });

  it('changes shared@iza.com authorisation when switching tenants', async () => {
    const token = tokenFor(ids.users.shared);
    const zauroh = await candidateCreateRequest(token, ids.tenants.zauroh);
    const khaleel = await candidateCreateRequest(token, ids.tenants.khaleel);
    const zaurohAgain = await candidateCreateRequest(token, ids.tenants.zauroh);

    expect(zauroh.status).toBe(403);
    expect(khaleel.status).toBe(200);
    expect(khaleel.body.role).toBe('RECRUITER');
    expect(zaurohAgain.status).toBe(403);
  });

  it('never merges roles from the shared user memberships', async () => {
    const token = tokenFor(ids.users.shared);
    const khaleel = await candidateCreateRequest(token, ids.tenants.khaleel);
    const zauroh = await candidateCreateRequest(token, ids.tenants.zauroh);

    expect(khaleel.status).toBe(200);
    expect(zauroh.status).toBe(403);
    expect(zauroh.body).toEqual(permissionForbiddenProblem);
  });

  it('ignores a client-provided role header', async () => {
    const response = await candidateCreateRequest(
      tokenFor(ids.users.shared),
      ids.tenants.zauroh,
    ).set('X-Tenant-Role', 'ADMIN');

    expect(response.status).toBe(403);
  });

  it('ignores a client-provided role query parameter', async () => {
    const response = await candidateCreateRequest(
      tokenFor(ids.users.shared),
      ids.tenants.zauroh,
    ).query({ role: 'ADMIN' });

    expect(response.status).toBe(403);
  });

  it('ignores a client-provided role body field', async () => {
    const response = await candidateCreateRequest(
      tokenFor(ids.users.shared),
      ids.tenants.zauroh,
    ).send({ role: 'ADMIN' });

    expect(response.status).toBe(403);
  });

  it('does not allow a client-provided permission value to grant access', async () => {
    const response = await candidateCreateRequest(
      tokenFor(ids.users.shared),
      ids.tenants.zauroh,
    )
      .set('X-Permission', PERMISSIONS.candidateCreate)
      .query({ permission: PERMISSIONS.candidateCreate })
      .send({ permission: PERMISSIONS.candidateCreate });

    expect(response.status).toBe(403);
    expect(response.body).toEqual(permissionForbiddenProblem);
  });

  it('ignores role and permission claims injected into a valid JWT', async () => {
    const token = tokenFor(ids.users.shared, {
      role: 'ADMIN',
      permission: PERMISSIONS.candidateCreate,
      permissions: [PERMISSIONS.candidateCreate],
    });
    const response = await candidateCreateRequest(token, ids.tenants.zauroh);

    expect(response.status).toBe(403);
    expect(response.body).toEqual(permissionForbiddenProblem);
  });
});

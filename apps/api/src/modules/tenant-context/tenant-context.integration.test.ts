import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { loadEnvironment } from '../../config/load-environment.js';

loadEnvironment();

const prisma = new PrismaClient();
const jwtConfig = {
  secret: 'tenant-context-integration-test-secret-value',
  expiresIn: '15m' as const,
};
const app = createApp({ prisma, jwtConfig });

const ids = {
  tenants: {
    zauroh: '10000000-0000-4000-8000-000000000001',
    khaleel: '10000000-0000-4000-8000-000000000002',
    nonexistent: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  },
  users: {
    admin: '20000000-0000-4000-8000-000000000001',
    shared: '20000000-0000-4000-8000-000000000004',
  },
  memberships: {
    zaurohAdmin: '30000000-0000-4000-8000-000000000001',
    zaurohShared: '30000000-0000-4000-8000-000000000004',
    khaleelShared: '30000000-0000-4000-8000-000000000005',
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

const invalidTenantHeaderProblem = {
  type: 'about:blank',
  title: 'Bad Request',
  status: 400,
  detail: 'X-Tenant-Id header must be a valid UUID.',
};

const tenantContextForbiddenProblem = {
  type: 'about:blank',
  title: 'Forbidden',
  status: 403,
  detail: 'Tenant context is not available for this user.',
};

function tokenFor(userId: string): string {
  return jwt.sign({}, jwtConfig.secret, {
    algorithm: 'HS256',
    expiresIn: jwtConfig.expiresIn,
    subject: userId,
  });
}

function contextRequest(token?: string, tenantId?: string) {
  const pendingRequest = request(app).get('/api/v1/context');

  if (token) {
    pendingRequest.set('Authorization', `Bearer ${token}`);
  }

  if (tenantId) {
    pendingRequest.set('X-Tenant-Id', tenantId);
  }

  return pendingRequest;
}

beforeAll(async () => {
  const memberships = await Promise.all([
    prisma.$queryRaw<Array<{ membership_id: string }>>`
      SELECT membership_id
      FROM public.validate_tenant_membership(
        ${ids.users.admin}::uuid,
        ${ids.tenants.zauroh}::uuid
      )
    `,
    prisma.$queryRaw<Array<{ membership_id: string }>>`
      SELECT membership_id
      FROM public.validate_tenant_membership(
        ${ids.users.shared}::uuid,
        ${ids.tenants.zauroh}::uuid
      )
    `,
    prisma.$queryRaw<Array<{ membership_id: string }>>`
      SELECT membership_id
      FROM public.validate_tenant_membership(
        ${ids.users.shared}::uuid,
        ${ids.tenants.khaleel}::uuid
      )
    `,
  ]);

  if (memberships.some((membership) => membership.length !== 1)) {
    throw new Error(
      'Run pnpm db:seed before tenant-context integration tests.',
    );
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /api/v1/context', () => {
  it('rejects an unauthenticated request before establishing tenant context', async () => {
    const response = await contextRequest(undefined, ids.tenants.zauroh);

    expect(response.status).toBe(401);
    expect(response.body).toEqual(authenticationRequiredProblem);
  });

  it('rejects an authenticated request without X-Tenant-Id', async () => {
    const response = await contextRequest(tokenFor(ids.users.admin));

    expect(response.status).toBe(400);
    expect(response.body).toEqual(tenantHeaderRequiredProblem);
  });

  it('rejects a malformed X-Tenant-Id', async () => {
    const token = tokenFor(ids.users.admin);
    const malformed = await contextRequest(token, 'not-a-uuid');

    expect(malformed.status).toBe(400);
    expect(malformed.body).toEqual(invalidTenantHeaderProblem);
  });

  it('normalises surrounding header whitespace before UUID validation', async () => {
    const response = await contextRequest(
      tokenFor(ids.users.admin),
      ` ${ids.tenants.zauroh} `,
    );

    expect(response.status).toBe(200);
    expect(response.body.tenantId).toBe(ids.tenants.zauroh);
    expect(response.body.role).toBe('ADMIN');
  });

  it('establishes context from a valid membership', async () => {
    const response = await contextRequest(
      tokenFor(ids.users.shared),
      ids.tenants.zauroh,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      tenantId: ids.tenants.zauroh,
      userId: ids.users.shared,
      membershipId: ids.memberships.zaurohShared,
      role: 'VIEWER',
    });
  });

  it('allows admin@iza.com to establish Zauroh context as ADMIN', async () => {
    const response = await contextRequest(
      tokenFor(ids.users.admin),
      ids.tenants.zauroh,
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      tenantId: ids.tenants.zauroh,
      userId: ids.users.admin,
      membershipId: ids.memberships.zaurohAdmin,
      role: 'ADMIN',
    });
  });

  it('forbids admin@iza.com from establishing Khaleel context', async () => {
    const response = await contextRequest(
      tokenFor(ids.users.admin),
      ids.tenants.khaleel,
    );

    expect(response.status).toBe(403);
    expect(response.body).toEqual(tenantContextForbiddenProblem);
  });

  it('establishes Zauroh context for shared@iza.com as VIEWER', async () => {
    const response = await contextRequest(
      tokenFor(ids.users.shared),
      ids.tenants.zauroh,
    );

    expect(response.status).toBe(200);
    expect(response.body.role).toBe('VIEWER');
    expect(response.body.membershipId).toBe(ids.memberships.zaurohShared);
  });

  it('establishes Khaleel context for shared@iza.com as RECRUITER', async () => {
    const response = await contextRequest(
      tokenFor(ids.users.shared),
      ids.tenants.khaleel,
    );

    expect(response.status).toBe(200);
    expect(response.body.role).toBe('RECRUITER');
    expect(response.body.membershipId).toBe(ids.memberships.khaleelShared);
  });

  it('does not retain a shared-user role when switching tenants', async () => {
    const token = tokenFor(ids.users.shared);
    const zauroh = await contextRequest(token, ids.tenants.zauroh);
    const khaleel = await contextRequest(token, ids.tenants.khaleel);
    const zaurohAgain = await contextRequest(token, ids.tenants.zauroh);

    expect(zauroh.body.role).toBe('VIEWER');
    expect(khaleel.body.role).toBe('RECRUITER');
    expect(zaurohAgain.body.role).toBe('VIEWER');
  });

  it('returns only the selected membership role without merging roles', async () => {
    const response = await contextRequest(
      tokenFor(ids.users.shared),
      ids.tenants.zauroh,
    );

    expect(response.status).toBe(200);
    expect(response.body.role).toBe('VIEWER');
    expect(response.body).not.toHaveProperty('roles');
    expect(Object.keys(response.body).sort()).toEqual([
      'membershipId',
      'role',
      'tenantId',
      'userId',
    ]);
  });

  it('forbids a syntactically valid nonexistent tenant UUID', async () => {
    const response = await contextRequest(
      tokenFor(ids.users.admin),
      ids.tenants.nonexistent,
    );

    expect(response.status).toBe(403);
    expect(response.body).toEqual(tenantContextForbiddenProblem);
  });

  it('uses equivalent public errors for non-member and nonexistent tenants', async () => {
    const token = tokenFor(ids.users.admin);
    const nonMember = await contextRequest(token, ids.tenants.khaleel);
    const nonexistent = await contextRequest(token, ids.tenants.nonexistent);

    expect(nonMember.status).toBe(403);
    expect(nonexistent.status).toBe(403);
    expect(nonexistent.body).toEqual(nonMember.body);
  });

  it('does not infer tenant context from a tenant-neutral JWT', async () => {
    const token = tokenFor(ids.users.shared);
    const payload = jwt.decode(token) as jwt.JwtPayload;
    const response = await contextRequest(token);

    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'sub']);
    expect(response.status).toBe(400);
    expect(response.body).toEqual(tenantHeaderRequiredProblem);
  });

  it('ignores client attempts to influence role outside X-Tenant-Id', async () => {
    const response = await contextRequest(
      tokenFor(ids.users.shared),
      ids.tenants.zauroh,
    )
      .set('X-Tenant-Role', 'ADMIN')
      .set('X-Membership-Id', ids.memberships.khaleelShared)
      .query({ tenantId: ids.tenants.khaleel, role: 'ADMIN' })
      .send({ tenantId: ids.tenants.khaleel, role: 'ADMIN' });

    expect(response.status).toBe(200);
    expect(response.body.tenantId).toBe(ids.tenants.zauroh);
    expect(response.body.membershipId).toBe(ids.memberships.zaurohShared);
    expect(response.body.role).toBe('VIEWER');
  });

  it('leaves login and authenticated identity routes tenant-neutral', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({
      email: 'shared@iza.com',
      password: 'ComplianceDemo123',
    });
    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`);

    expect(login.status).toBe(200);
    expect(me.status).toBe(200);
    expect(JSON.stringify(login.body)).not.toMatch(
      /tenant|membership|role|permission/i,
    );
    expect(JSON.stringify(me.body)).not.toMatch(
      /tenant|membership|role|permission/i,
    );
  });
});

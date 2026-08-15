import { PrismaClient, TenantRole } from '@prisma/client';
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
const jwtConfig = {
  secret: 'membership-discovery-integration-test-secret',
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
    shared: '20000000-0000-4000-8000-000000000004',
    withoutMemberships: '27000000-0000-4000-8000-000000000001',
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

function tokenFor(userId: string, expiresIn: '15m' | number = '15m'): string {
  return jwt.sign({}, jwtConfig.secret, {
    algorithm: 'HS256',
    expiresIn,
    subject: userId,
  });
}

function membershipRequest(token?: string) {
  const pending = request(app).get('/api/v1/memberships');

  if (token) {
    pending.set('Authorization', `Bearer ${token}`);
  }

  return pending;
}

beforeAll(async () => {
  const seededMemberships = await adminPrisma.tenantMembership.count({
    where: {
      id: {
        in: [
          ids.memberships.zaurohAdmin,
          ids.memberships.zaurohShared,
          ids.memberships.khaleelShared,
        ],
      },
    },
  });

  if (seededMemberships !== 3) {
    throw new Error(
      'Run pnpm db:seed before membership discovery integration tests.',
    );
  }

  await adminPrisma.user.upsert({
    where: { id: ids.users.withoutMemberships },
    create: {
      id: ids.users.withoutMemberships,
      email: 'membership-free-user@local.invalid',
      displayName: 'Membership-free Test User',
      passwordHash: 'not-used-for-token-authentication',
    },
    update: {},
  });
});

afterAll(async () => {
  await adminPrisma.user.deleteMany({
    where: { id: ids.users.withoutMemberships },
  });
  await Promise.all([runtimePrisma.$disconnect(), adminPrisma.$disconnect()]);
});

describe('GET /api/v1/memberships', () => {
  it('returns exactly one membership option for a single-tenant actor', async () => {
    const response = await membershipRequest(tokenFor(ids.users.admin));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      memberships: [
        {
          membershipId: ids.memberships.zaurohAdmin,
          tenantId: ids.tenants.zauroh,
          tenantName: 'Zauroh Recruitment',
          role: TenantRole.ADMIN,
        },
      ],
    });
    expect(Object.keys(response.body.memberships[0]).sort()).toEqual([
      'membershipId',
      'role',
      'tenantId',
      'tenantName',
    ]);
  });

  it('returns only the actor memberships in deterministic tenant-name order', async () => {
    const response = await membershipRequest(tokenFor(ids.users.shared));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      memberships: [
        {
          membershipId: ids.memberships.khaleelShared,
          tenantId: ids.tenants.khaleel,
          tenantName: 'Khaleel Care Staffing',
          role: TenantRole.RECRUITER,
        },
        {
          membershipId: ids.memberships.zaurohShared,
          tenantId: ids.tenants.zauroh,
          tenantName: 'Zauroh Recruitment',
          role: TenantRole.VIEWER,
        },
      ],
    });
    expect(
      response.body.memberships.map(
        (membership: { membershipId: string }) => membership.membershipId,
      ),
    ).not.toContain(ids.memberships.zaurohAdmin);
  });

  it('returns an empty list when the authenticated actor has no memberships', async () => {
    const response = await membershipRequest(
      tokenFor(ids.users.withoutMemberships),
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ memberships: [] });
  });

  it('ignores tenant and identity selectors and uses only authenticated state', async () => {
    const response = await membershipRequest(tokenFor(ids.users.admin))
      .set('X-Tenant-Id', ids.tenants.khaleel)
      .set('X-User-Id', ids.users.shared)
      .query({ userId: ids.users.shared, tenantId: ids.tenants.khaleel })
      .send({ userId: ids.users.shared, tenantId: ids.tenants.khaleel });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      memberships: [
        {
          membershipId: ids.memberships.zaurohAdmin,
          tenantId: ids.tenants.zauroh,
          tenantName: 'Zauroh Recruitment',
          role: TenantRole.ADMIN,
        },
      ],
    });
  });

  it('returns the generic 401 response when authentication is missing', async () => {
    const response = await membershipRequest();

    expect(response.status).toBe(401);
    expect(response.body).toEqual(authenticationRequiredProblem);
  });

  it('returns the generic 401 response for malformed authentication', async () => {
    const response = await membershipRequest('not-a-jwt');

    expect(response.status).toBe(401);
    expect(response.body).toEqual(authenticationRequiredProblem);
  });

  it('returns the generic 401 response for expired authentication', async () => {
    const response = await membershipRequest(tokenFor(ids.users.admin, -1));

    expect(response.status).toBe(401);
    expect(response.body).toEqual(authenticationRequiredProblem);
  });
});

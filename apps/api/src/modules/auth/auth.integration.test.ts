import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { loadEnvironment } from '../../config/load-environment.js';

loadEnvironment();

const prisma = new PrismaClient();
const jwtConfig = {
  secret: 'authentication-integration-test-secret-value',
  expiresIn: '15m' as const,
};
const app = createApp({ prisma, jwtConfig });
const password = 'ComplianceDemo123';

const invalidCredentialsProblem = {
  type: 'about:blank',
  title: 'Unauthorized',
  status: 401,
  detail: 'Invalid email or password.',
};

const authenticationRequiredProblem = {
  type: 'about:blank',
  title: 'Unauthorized',
  status: 401,
  detail: 'A valid Bearer access token is required.',
};

async function login(email: string, suppliedPassword = password) {
  return request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: suppliedPassword });
}

beforeAll(async () => {
  const seededUsers = await prisma.user.count({
    where: {
      email: { in: ['admin@iza.com', 'shared@iza.com'] },
    },
  });

  if (seededUsers !== 2) {
    throw new Error(
      'Run pnpm db:seed before authentication integration tests.',
    );
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /api/v1/auth/login', () => {
  it('returns an access token and safe identity for valid seeded credentials', async () => {
    const response = await login('admin@iza.com');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      tokenType: 'Bearer',
      user: {
        email: 'admin@iza.com',
        displayName: 'Zauroh Administrator',
      },
    });
    expect(response.body.accessToken).toEqual(expect.any(String));
  });

  it('uses PostgreSQL CITEXT equality for case-variant email input', async () => {
    const response = await login('  AdMiN@IzA.CoM  ');

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe('admin@iza.com');
  });

  it('returns 401 for a wrong password', async () => {
    const response = await login('admin@iza.com', 'wrong-password');

    expect(response.status).toBe(401);
    expect(response.body).toEqual(invalidCredentialsProblem);
  });

  it('returns the same public 401 response for an unknown email', async () => {
    const wrongPassword = await login('admin@iza.com', 'wrong-password');
    const unknownEmail = await login('unknown@iza.com');

    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.body).toEqual(wrongPassword.body);
  });

  it('returns Problem Details for invalid request data', async () => {
    const response = await login('not-an-email', '');

    expect(response.status).toBe(400);
    expect(response.type).toBe('application/problem+json');
    expect(response.body).toMatchObject({
      type: 'about:blank',
      title: 'Bad Request',
      status: 400,
      detail: 'The request data is invalid.',
    });
  });

  it('never returns a password or password hash', async () => {
    const response = await login('admin@iza.com');
    const output = JSON.stringify(response.body);

    expect(response.status).toBe(200);
    expect(output).not.toMatch(/password|hash/i);
  });

  it('authenticates the shared user without selecting a tenant or role', async () => {
    const response = await login('shared@iza.com');
    const output = JSON.stringify(response.body);

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({
      email: 'shared@iza.com',
      displayName: 'Shared Demo User',
    });
    expect(output).not.toMatch(/tenant|membership|role|permission/i);
  });

  it('issues only identity and standard timing claims', async () => {
    const response = await login('shared@iza.com');
    const payload = jwt.decode(response.body.accessToken) as jwt.JwtPayload;

    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'sub']);
    expect(payload.sub).toBe(response.body.user.id);
    expect(payload.exp! - payload.iat!).toBe(15 * 60);
  });
});

describe('GET /api/v1/auth/me', () => {
  it('resolves the current user for a valid token', async () => {
    const loginResponse = await login('admin@iza.com');
    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${loginResponse.body.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(loginResponse.body.user);
    expect(JSON.stringify(response.body)).not.toMatch(
      /password|hash|tenant|membership|role|permission/i,
    );
  });

  it('does not allow client identity values to replace the token subject', async () => {
    const loginResponse = await login('admin@iza.com');
    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${loginResponse.body.accessToken}`)
      .set('X-User-Id', '20000000-0000-4000-8000-000000000004')
      .set('X-User-Email', 'shared@iza.com')
      .query({
        userId: '20000000-0000-4000-8000-000000000004',
        email: 'shared@iza.com',
      })
      .send({
        userId: '20000000-0000-4000-8000-000000000004',
        email: 'shared@iza.com',
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(loginResponse.body.user);
    expect(response.body.email).toBe('admin@iza.com');
  });

  it('returns 401 when the token is missing', async () => {
    const response = await request(app).get('/api/v1/auth/me');

    expect(response.status).toBe(401);
    expect(response.body).toEqual(authenticationRequiredProblem);
  });

  it('returns 401 for a malformed token', async () => {
    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer not-a-jwt');

    expect(response.status).toBe(401);
    expect(response.body).toEqual(authenticationRequiredProblem);
  });

  it('returns 401 for an expired token', async () => {
    const token = jwt.sign({}, jwtConfig.secret, {
      algorithm: 'HS256',
      expiresIn: -1,
      subject: '20000000-0000-4000-8000-000000000001',
    });
    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(response.body).toEqual(authenticationRequiredProblem);
  });

  it('returns 401 for a forged token', async () => {
    const token = jwt.sign({}, 'different-signing-secret-value-32-chars', {
      algorithm: 'HS256',
      expiresIn: '15m',
      subject: '20000000-0000-4000-8000-000000000001',
    });
    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(response.body).toEqual(authenticationRequiredProblem);
  });

  it('returns 401 when a valid token references a nonexistent user', async () => {
    const token = jwt.sign({}, jwtConfig.secret, {
      algorithm: 'HS256',
      expiresIn: '15m',
      subject: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    });
    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(response.body).toEqual(authenticationRequiredProblem);
  });
});

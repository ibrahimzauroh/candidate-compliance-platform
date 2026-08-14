import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';

import { createApp } from './app.js';

const prisma = new PrismaClient();
const app = createApp({
  prisma,
  jwtConfig: {
    secret: 'health-test-secret-with-at-least-32-characters',
    expiresIn: '15m',
  },
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /health', () => {
  it('returns a healthy response', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});

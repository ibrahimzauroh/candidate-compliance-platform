import { describe, expect, it } from 'vitest';

import {
  healthResponseSchema,
  loginRequestSchema,
  problemDetailsSchema,
  tenantContextSchema,
} from './index.js';

describe('healthResponseSchema', () => {
  it('accepts the API health response', () => {
    expect(healthResponseSchema.parse({ status: 'ok' })).toEqual({
      status: 'ok',
    });
  });

  it('rejects unsupported states', () => {
    expect(() => healthResponseSchema.parse({ status: 'unhealthy' })).toThrow();
  });
});

describe('loginRequestSchema', () => {
  it('trims a valid email without changing its case', () => {
    expect(
      loginRequestSchema.parse({
        email: '  Admin@IZA.com  ',
        password: 'historical-password',
      }),
    ).toEqual({
      email: 'Admin@IZA.com',
      password: 'historical-password',
    });
  });

  it('rejects an invalid email and empty password', () => {
    expect(() =>
      loginRequestSchema.parse({ email: 'not-an-email', password: '' }),
    ).toThrow();
  });
});

describe('problemDetailsSchema', () => {
  it('accepts an RFC 9457-style authentication problem', () => {
    expect(
      problemDetailsSchema.parse({
        type: 'about:blank',
        title: 'Unauthorized',
        status: 401,
        detail: 'Invalid email or password.',
      }),
    ).toEqual({
      type: 'about:blank',
      title: 'Unauthorized',
      status: 401,
      detail: 'Invalid email or password.',
    });
  });
});

describe('tenantContextSchema', () => {
  it('accepts a validated tenant membership context', () => {
    expect(
      tenantContextSchema.parse({
        tenantId: '10000000-0000-4000-8000-000000000001',
        userId: '20000000-0000-4000-8000-000000000004',
        membershipId: '30000000-0000-4000-8000-000000000004',
        role: 'VIEWER',
      }),
    ).toEqual({
      tenantId: '10000000-0000-4000-8000-000000000001',
      userId: '20000000-0000-4000-8000-000000000004',
      membershipId: '30000000-0000-4000-8000-000000000004',
      role: 'VIEWER',
    });
  });

  it('rejects an unsupported tenant role', () => {
    expect(() =>
      tenantContextSchema.parse({
        tenantId: '10000000-0000-4000-8000-000000000001',
        userId: '20000000-0000-4000-8000-000000000004',
        membershipId: '30000000-0000-4000-8000-000000000004',
        role: 'OWNER',
      }),
    ).toThrow();
  });
});

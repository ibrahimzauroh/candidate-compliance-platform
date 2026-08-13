import { describe, expect, it } from 'vitest';

import {
  healthResponseSchema,
  loginRequestSchema,
  problemDetailsSchema,
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

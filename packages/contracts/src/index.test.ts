import { describe, expect, it } from 'vitest';

import { healthResponseSchema } from './index.js';

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

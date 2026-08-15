import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { isSameOriginRequest } from './request-security';

describe('isSameOriginRequest', () => {
  it('accepts an exact same-origin browser mutation', () => {
    const request = new NextRequest('http://localhost:3000/api/session/login', {
      headers: { Origin: 'http://localhost:3000' },
    });

    expect(isSameOriginRequest(request)).toBe(true);
  });

  it('rejects a cross-origin mutation', () => {
    const request = new NextRequest('http://localhost:3000/api/session/login', {
      headers: { Origin: 'https://untrusted.invalid' },
    });

    expect(isSameOriginRequest(request)).toBe(false);
  });

  it('rejects a mutation without browser origin evidence', () => {
    const request = new NextRequest('http://localhost:3000/api/session/login');

    expect(isSameOriginRequest(request)).toBe(false);
  });
});

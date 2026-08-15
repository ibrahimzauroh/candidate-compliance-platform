import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { POST as login } from './login/route';
import { POST as logout } from './logout/route';
import { GET as memberships } from './memberships/route';
import { POST as selectTenant } from './tenant/route';

const actor = {
  id: '20000000-0000-4000-8000-000000000001',
  email: 'admin@example.test',
  displayName: 'Demo Administrator',
};
const membership = {
  membershipId: '30000000-0000-4000-8000-000000000001',
  tenantId: '10000000-0000-4000-8000-000000000001',
  tenantName: 'Alpha Staffing',
  role: 'ADMIN',
} as const;

function browserRequest(
  path: string,
  init?: {
    method?: string;
    body?: BodyInit;
    headers?: Record<string, string>;
  },
): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    ...init,
    headers: {
      Origin: 'http://localhost:3000',
      ...init?.headers,
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('frontend session routes', () => {
  it('keeps the API token out of the login response and stores it HttpOnly', async () => {
    const token = 'sensitive-token-that-must-not-reach-client-javascript';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          accessToken: token,
          tokenType: 'Bearer',
          user: actor,
        }),
      ),
    );

    const response = await login(
      browserRequest('/api/session/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'admin@example.test',
          password: 'valid-password',
        }),
      }),
    );
    const body = await response.json();
    const cookies = response.headers.get('set-cookie') ?? '';

    expect(response.status).toBe(200);
    expect(body).toEqual(actor);
    expect(JSON.stringify(body)).not.toContain(token);
    expect(cookies).toContain('candidate_compliance_session=');
    expect(cookies).toContain('HttpOnly');
    expect(cookies).toContain('SameSite=lax');
  });

  it('discovers memberships without attaching tenant context', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ memberships: [membership] }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await memberships(
      browserRequest('/api/session/memberships', {
        headers: { Cookie: 'candidate_compliance_session=opaque-token' },
      }),
    );
    const upstreamHeaders = fetchMock.mock.calls[0]![1]!.headers as Headers;

    expect(response.status).toBe(200);
    expect(upstreamHeaders.has('X-Tenant-Id')).toBe(false);
    expect(upstreamHeaders.get('Authorization')).toBe('Bearer opaque-token');
  });

  it('rejects a tenant not returned by current membership discovery', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ memberships: [membership] }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await selectTenant(
      browserRequest('/api/session/tenant', {
        method: 'POST',
        headers: { Cookie: 'candidate_compliance_session=opaque-token' },
        body: JSON.stringify({
          tenantId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('validates an allowed membership through the backend context route', async () => {
    const tenantContext = {
      tenantId: membership.tenantId,
      userId: actor.id,
      membershipId: membership.membershipId,
      role: membership.role,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ memberships: [membership] }))
      .mockResolvedValueOnce(Response.json(tenantContext));
    vi.stubGlobal('fetch', fetchMock);

    const response = await selectTenant(
      browserRequest('/api/session/tenant', {
        method: 'POST',
        headers: { Cookie: 'candidate_compliance_session=opaque-token' },
        body: JSON.stringify({ tenantId: membership.tenantId }),
      }),
    );
    const contextHeaders = fetchMock.mock.calls[1]![1]!.headers as Headers;

    expect(response.status).toBe(200);
    expect(contextHeaders.get('X-Tenant-Id')).toBe(membership.tenantId);
    expect(response.headers.get('set-cookie')).toContain(
      `candidate_compliance_tenant=${membership.tenantId}`,
    );
  });

  it('clears authentication and tenant cookies on local sign out', async () => {
    const response = await logout(
      browserRequest('/api/session/logout', { method: 'POST' }),
    );
    const cookies = response.headers.get('set-cookie') ?? '';

    expect(response.status).toBe(204);
    expect(cookies).toContain('candidate_compliance_session=');
    expect(cookies).toContain('candidate_compliance_tenant=');
    expect(cookies).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  });
});

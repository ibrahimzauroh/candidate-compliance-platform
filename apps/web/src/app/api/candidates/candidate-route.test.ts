import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { POST } from './route';

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
const tenantContext = {
  tenantId: membership.tenantId,
  userId: actor.id,
  membershipId: membership.membershipId,
  role: membership.role,
};
const candidate = {
  id: '50000000-0000-4000-8000-000000000001',
  fullName: 'Ada Candidate',
  email: 'ada@example.test',
  roleAppliedFor: 'Compliance Engineer',
  createdAt: '2026-08-15T10:00:00.000Z',
  updatedAt: '2026-08-15T10:00:00.000Z',
};
const envelope = {
  attemptId: '40000000-0000-4000-8000-000000000001',
  candidate: {
    fullName: candidate.fullName,
    email: candidate.email,
    roleAppliedFor: candidate.roleAppliedFor,
  },
};

function candidateRequest(
  body: unknown = envelope,
  selectedTenantId: string = membership.tenantId,
): NextRequest {
  return new NextRequest('http://localhost:3000/api/candidates', {
    method: 'POST',
    headers: {
      Origin: 'http://localhost:3000',
      Cookie: [
        'candidate_compliance_session=opaque-token',
        `candidate_compliance_tenant=${selectedTenantId}`,
      ].join('; '),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function successfulUpstream() {
  return vi.fn().mockImplementation((input: string | URL | Request) => {
    const url = String(input);

    if (url.endsWith('/api/v1/auth/me')) {
      return Promise.resolve(Response.json(actor));
    }

    if (url.endsWith('/api/v1/memberships')) {
      return Promise.resolve(Response.json({ memberships: [membership] }));
    }

    if (url.endsWith('/api/v1/context')) {
      return Promise.resolve(Response.json(tenantContext));
    }

    if (url.endsWith('/api/v1/candidates')) {
      return Promise.resolve(Response.json(candidate, { status: 201 }));
    }

    throw new Error(`Unexpected upstream URL: ${url}`);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('frontend Candidate route', () => {
  it('uses only validated server tenant context and a derived idempotency key', async () => {
    const fetchMock = successfulUpstream();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(candidateRequest());
    const candidateCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/api/v1/candidates'),
    )!;
    const init = candidateCall[1] as RequestInit;
    const headers = init.headers as Headers;
    const upstreamBody = JSON.parse(init.body as string);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(candidate);
    expect(headers.get('X-Tenant-Id')).toBe(membership.tenantId);
    expect(headers.get('Authorization')).toBe('Bearer opaque-token');
    expect(headers.get('Idempotency-Key')).toMatch(
      /^candidate:create:[a-f0-9]{64}$/,
    );
    expect(headers.get('Idempotency-Key')).not.toContain(envelope.attemptId);
    expect(upstreamBody).toEqual(envelope.candidate);
    expect(upstreamBody).not.toHaveProperty('tenantId');
  });

  it('derives the same upstream key when the same logical attempt is retried', async () => {
    const fetchMock = successfulUpstream();
    vi.stubGlobal('fetch', fetchMock);

    await POST(candidateRequest());
    await POST(candidateRequest());

    const keys = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith('/api/v1/candidates'))
      .map(([, init]) => (init!.headers as Headers).get('Idempotency-Key'));
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it('rejects tenant input and never forwards it to the Candidate API', async () => {
    const fetchMock = successfulUpstream();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      candidateRequest({
        ...envelope,
        candidate: {
          ...envelope.candidate,
          tenantId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        },
      }),
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cannot use a stale selected tenant outside current memberships', async () => {
    const fetchMock = successfulUpstream();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      candidateRequest(envelope, 'ffffffff-ffff-4fff-8fff-ffffffffffff'),
    );

    expect(response.status).toBe(403);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith('/api/v1/candidates'),
      ),
    ).toBe(false);
  });
});

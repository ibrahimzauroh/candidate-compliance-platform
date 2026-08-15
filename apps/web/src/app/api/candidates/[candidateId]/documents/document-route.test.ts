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
const candidateId = '40000000-0000-4000-8000-000000000001';
const document = {
  id: '50000000-0000-4000-8000-000000000001',
  candidateId,
  type: 'RIGHT_TO_WORK' as const,
  currentVersion: {
    id: '60000000-0000-4000-8000-000000000001',
    versionNumber: 1,
    issueDate: '2026-08-01',
    expiryDate: '2027-08-01',
    status: 'DRAFT' as const,
    createdAt: '2026-08-15T10:00:00.000Z',
  },
  createdAt: '2026-08-15T10:00:00.000Z',
  updatedAt: '2026-08-15T10:00:00.000Z',
};
const envelope = {
  attemptId: '70000000-0000-4000-8000-000000000001',
  document: {
    type: document.type,
    issueDate: document.currentVersion.issueDate,
    expiryDate: document.currentVersion.expiryDate,
  },
};

function routeContext(id = candidateId) {
  return { params: Promise.resolve({ candidateId: id }) };
}

function documentRequest(
  body: unknown = envelope,
  selectedTenantId: string = membership.tenantId,
): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/candidates/${candidateId}/documents`,
    {
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
    },
  );
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

    if (url.endsWith(`/api/v1/candidates/${candidateId}/documents`)) {
      return Promise.resolve(Response.json(document, { status: 201 }));
    }

    throw new Error(`Unexpected upstream URL: ${url}`);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('frontend ComplianceDocument route', () => {
  it('returns the existing generic 401 without an authenticated session', async () => {
    const request = new NextRequest(
      `http://localhost:3000/api/candidates/${candidateId}/documents`,
      {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:3000',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(envelope),
      },
    );

    const response = await POST(request, routeContext());

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      title: 'Unauthorized',
      status: 401,
    });
  });

  it('uses the validated tenant and a server-derived idempotency key', async () => {
    const fetchMock = successfulUpstream();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(documentRequest(), routeContext());
    const upstreamCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith(`/api/v1/candidates/${candidateId}/documents`),
    )!;
    const init = upstreamCall[1] as RequestInit;
    const headers = init.headers as Headers;
    const upstreamBody = JSON.parse(init.body as string);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(document);
    expect(headers.get('X-Tenant-Id')).toBe(membership.tenantId);
    expect(headers.get('Authorization')).toBe('Bearer opaque-token');
    expect(headers.get('Idempotency-Key')).toMatch(
      /^document:create:[a-f0-9]{64}$/,
    );
    expect(headers.get('Idempotency-Key')).not.toContain(envelope.attemptId);
    expect(upstreamBody).toEqual(envelope.document);
    expect(upstreamBody).not.toHaveProperty('tenantId');
  });

  it('keeps the upstream key stable for the same logical retry', async () => {
    const fetchMock = successfulUpstream();
    vi.stubGlobal('fetch', fetchMock);

    await POST(documentRequest(), routeContext());
    await POST(documentRequest(), routeContext());

    const keys = fetchMock.mock.calls
      .filter(([url]) =>
        String(url).endsWith(`/api/v1/candidates/${candidateId}/documents`),
      )
      .map(([, init]) => (init!.headers as Headers).get('Idempotency-Key'));
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it('rejects caller-supplied tenant or Candidate ownership fields', async () => {
    const fetchMock = successfulUpstream();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      documentRequest({
        ...envelope,
        document: {
          ...envelope.document,
          tenantId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          candidateId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        },
      }),
      routeContext(),
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not call the document API for a stale tenant selection', async () => {
    const fetchMock = successfulUpstream();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(
      documentRequest(envelope, 'ffffffff-ffff-4fff-8fff-ffffffffffff'),
      routeContext(),
    );

    expect(response.status).toBe(403);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith(`/api/v1/candidates/${candidateId}/documents`),
      ),
    ).toBe(false);
  });

  it('rejects malformed Candidate locators before any upstream request', async () => {
    const fetchMock = successfulUpstream();
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(documentRequest(), routeContext('not-a-uuid'));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { POST as approveDocument } from './approve/route';
import { POST as correctDocument } from './corrections/route';
import { GET as getHistory } from './versions/route';

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
const documentId = '50000000-0000-4000-8000-000000000001';
const attemptId = '70000000-0000-4000-8000-000000000001';
const approvedDocument = {
  id: documentId,
  candidateId: '40000000-0000-4000-8000-000000000001',
  type: 'RIGHT_TO_WORK' as const,
  currentVersion: {
    id: '60000000-0000-4000-8000-000000000001',
    versionNumber: 1,
    issueDate: '2026-08-01',
    expiryDate: '2027-08-01',
    status: 'APPROVED' as const,
    createdAt: '2026-08-15T10:00:00.000Z',
  },
  createdAt: '2026-08-15T10:00:00.000Z',
  updatedAt: '2026-08-15T10:05:00.000Z',
};
const correctedDocument = {
  ...approvedDocument,
  currentVersion: {
    ...approvedDocument.currentVersion,
    id: '60000000-0000-4000-8000-000000000002',
    versionNumber: 2,
    status: 'DRAFT' as const,
    expiryDate: '2028-08-01',
    createdAt: '2026-08-15T10:10:00.000Z',
  },
  updatedAt: '2026-08-15T10:10:00.000Z',
};
const history = {
  items: [
    { ...approvedDocument.currentVersion, isCurrent: false },
    { ...correctedDocument.currentVersion, isCurrent: true },
  ],
};

function context(id = documentId) {
  return { params: Promise.resolve({ documentId: id }) };
}

function request(
  path: string,
  method: 'GET' | 'POST',
  body?: unknown,
  tenantId: string = membership.tenantId,
): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: {
      Origin: 'http://localhost:3000',
      Cookie: [
        'candidate_compliance_session=opaque-token',
        `candidate_compliance_tenant=${tenantId}`,
      ].join('; '),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
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
    if (url.endsWith(`/api/v1/documents/${documentId}/versions`)) {
      return Promise.resolve(Response.json(history));
    }
    if (url.endsWith(`/api/v1/documents/${documentId}/approve`)) {
      return Promise.resolve(Response.json(approvedDocument));
    }
    if (url.endsWith(`/api/v1/documents/${documentId}/corrections`)) {
      return Promise.resolve(Response.json(correctedDocument, { status: 201 }));
    }

    throw new Error(`Unexpected upstream URL: ${url}`);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('frontend document lifecycle routes', () => {
  it('reads history through validated tenant context without mutation headers', async () => {
    const fetchMock = successfulUpstream();
    vi.stubGlobal('fetch', fetchMock);

    const response = await getHistory(
      request(`/api/documents/${documentId}/versions`, 'GET'),
      context(),
    );
    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith(`/api/v1/documents/${documentId}/versions`),
    )!;
    const headers = (call[1] as RequestInit).headers as Headers;

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(history);
    expect(headers.get('X-Tenant-Id')).toBe(membership.tenantId);
    expect(headers.get('Authorization')).toBe('Bearer opaque-token');
    expect(headers.has('Idempotency-Key')).toBe(false);
  });

  it('approves with a stable server-derived key and an empty backend body', async () => {
    const fetchMock = successfulUpstream();
    vi.stubGlobal('fetch', fetchMock);
    const browserRequest = () =>
      request(`/api/documents/${documentId}/approve`, 'POST', { attemptId });

    await approveDocument(browserRequest(), context());
    await approveDocument(browserRequest(), context());

    const calls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith(`/api/v1/documents/${documentId}/approve`),
    );
    const firstInit = calls[0]![1] as RequestInit;
    const secondInit = calls[1]![1] as RequestInit;
    const firstKey = (firstInit.headers as Headers).get('Idempotency-Key');

    expect(calls).toHaveLength(2);
    expect(firstKey).toMatch(/^document:approve:[a-f0-9]{64}$/);
    expect(firstKey).not.toContain(attemptId);
    expect((secondInit.headers as Headers).get('Idempotency-Key')).toBe(
      firstKey,
    );
    expect(JSON.parse(firstInit.body as string)).toEqual({});
  });

  it('creates a correction with only complete nullable lifecycle metadata', async () => {
    const fetchMock = successfulUpstream();
    vi.stubGlobal('fetch', fetchMock);
    const correction = { issueDate: null, expiryDate: '2028-08-01' };

    const response = await correctDocument(
      request(`/api/documents/${documentId}/corrections`, 'POST', {
        attemptId,
        correction,
      }),
      context(),
    );
    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith(`/api/v1/documents/${documentId}/corrections`),
    )!;
    const init = call[1] as RequestInit;
    const headers = init.headers as Headers;

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(correctedDocument);
    expect(headers.get('X-Tenant-Id')).toBe(membership.tenantId);
    expect(headers.get('Idempotency-Key')).toMatch(
      /^document:correct:[a-f0-9]{64}$/,
    );
    expect(JSON.parse(init.body as string)).toEqual(correction);
  });

  it.each([
    ['approve', approveDocument, { attemptId, tenantId: membership.tenantId }],
    [
      'correction',
      correctDocument,
      {
        attemptId,
        correction: { issueDate: null, expiryDate: null },
        idempotencyKey: 'caller-key',
      },
    ],
  ])(
    'rejects caller-controlled scope in the %s envelope',
    async (_label, handler, body) => {
      const fetchMock = successfulUpstream();
      vi.stubGlobal('fetch', fetchMock);

      const response = await handler(
        request(`/api/documents/${documentId}/${_label}`, 'POST', body),
        context(),
      );

      expect(response.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('does not call lifecycle operations for a stale tenant selection', async () => {
    const fetchMock = successfulUpstream();
    vi.stubGlobal('fetch', fetchMock);

    const response = await approveDocument(
      request(
        `/api/documents/${documentId}/approve`,
        'POST',
        { attemptId },
        'ffffffff-ffff-4fff-8fff-ffffffffffff',
      ),
      context(),
    );

    expect(response.status).toBe(403);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes(`/api/v1/documents/${documentId}/approve`),
      ),
    ).toBe(false);
  });

  it('preserves neutral not-found behavior from the tenant-scoped history read', async () => {
    const fetchMock = successfulUpstream().mockImplementation(
      (input: string | URL | Request) => {
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

        return Promise.resolve(
          Response.json(
            {
              type: 'about:blank',
              title: 'Not Found',
              status: 404,
              detail: 'The requested resource was not found.',
            },
            { status: 404 },
          ),
        );
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await getHistory(
      request(`/api/documents/${documentId}/versions`, 'GET'),
      context(),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'The requested resource was not found.',
    });
  });

  it('preserves neutral upstream denial and clears an expired session', async () => {
    const fetchMock = successfulUpstream().mockImplementationOnce(() =>
      Promise.resolve(
        Response.json(
          {
            type: 'about:blank',
            title: 'Unauthorized',
            status: 401,
            detail: 'Authentication is required.',
          },
          { status: 401 },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await getHistory(
      request(`/api/documents/${documentId}/versions`, 'GET'),
      context(),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toContain(
      'candidate_compliance_session=',
    );
  });
});

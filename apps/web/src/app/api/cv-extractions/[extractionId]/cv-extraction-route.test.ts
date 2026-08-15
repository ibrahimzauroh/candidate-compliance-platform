import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { POST as uploadCv } from '../../candidates/[candidateId]/cv-extractions/route';
import { POST as confirmCv } from './confirm/route';
import { POST as rejectCv } from './reject/route';
import { GET as getCv } from './route';

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
const extractionId = '50000000-0000-4000-8000-000000000001';
const attemptId = '60000000-0000-4000-8000-000000000001';
const profile = {
  fullName: 'Ada Candidate',
  skills: ['TypeScript'],
  yearsOfExperience: 6,
  certifications: [],
};
const proposed = {
  id: extractionId,
  candidateId,
  purpose: 'CANDIDATE_PROFILE' as const,
  provider: 'local-mock',
  model: 'deterministic-v1',
  status: 'PROPOSED' as const,
  proposedOutput: profile,
  confirmedOutput: null,
  createdAt: '2026-08-15T10:00:00.000Z',
  decidedAt: null,
  updatedAt: '2026-08-15T10:00:00.000Z',
};
const accepted = {
  ...proposed,
  status: 'ACCEPTED' as const,
  confirmedOutput: profile,
  decidedAt: '2026-08-15T10:05:00.000Z',
  updatedAt: '2026-08-15T10:05:00.000Z',
};
const rejected = {
  ...proposed,
  status: 'REJECTED' as const,
  decidedAt: '2026-08-15T10:05:00.000Z',
  updatedAt: '2026-08-15T10:05:00.000Z',
};

function extractionContext(id = extractionId) {
  return { params: Promise.resolve({ extractionId: id }) };
}

function candidateContext(id = candidateId) {
  return { params: Promise.resolve({ candidateId: id }) };
}

function browserRequest(
  path: string,
  method: 'GET' | 'POST',
  body?: BodyInit,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: {
      Origin: 'http://localhost:3000',
      Cookie: [
        'candidate_compliance_session=opaque-token',
        `candidate_compliance_tenant=${membership.tenantId}`,
      ].join('; '),
      ...headers,
    },
    body,
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
    if (url.endsWith(`/api/v1/candidates/${candidateId}/cv-extractions`)) {
      return Promise.resolve(Response.json(proposed, { status: 201 }));
    }
    if (url.endsWith(`/api/v1/cv-extractions/${extractionId}/confirm`)) {
      return Promise.resolve(Response.json(accepted));
    }
    if (url.endsWith(`/api/v1/cv-extractions/${extractionId}/reject`)) {
      return Promise.resolve(Response.json(rejected));
    }
    if (url.endsWith(`/api/v1/cv-extractions/${extractionId}`)) {
      return Promise.resolve(Response.json(proposed));
    }

    throw new Error(`Unexpected upstream URL: ${url}`);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('frontend CV extraction routes', () => {
  it('uploads exact raw content through validated server tenant context and a derived key', async () => {
    const fetchMock = successfulUpstream();
    vi.stubGlobal('fetch', fetchMock);

    const response = await uploadCv(
      browserRequest(
        `/api/candidates/${candidateId}/cv-extractions`,
        'POST',
        'Ada CV',
        {
          'Content-Type': 'text/plain',
          'X-CV-Attempt-Id': attemptId,
          'X-Tenant-Id': 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          'Idempotency-Key': 'caller-controlled',
        },
      ),
      candidateContext(),
    );
    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith(`/api/v1/candidates/${candidateId}/cv-extractions`),
    )!;
    const init = call[1] as RequestInit;
    const upstreamHeaders = init.headers as Headers;

    expect(response.status).toBe(201);
    expect(upstreamHeaders.get('X-Tenant-Id')).toBe(membership.tenantId);
    expect(upstreamHeaders.get('Idempotency-Key')).toMatch(
      /^cv:extract:[a-f0-9]{64}$/,
    );
    expect(upstreamHeaders.get('Idempotency-Key')).not.toContain(attemptId);
    expect(upstreamHeaders.get('Content-Type')).toBe('text/plain');
    expect(new TextDecoder().decode(init.body as Uint8Array)).toBe('Ada CV');
  });

  it('rejects invalid upload metadata before calling the backend', async () => {
    const fetchMock = successfulUpstream();
    vi.stubGlobal('fetch', fetchMock);

    const response = await uploadCv(
      browserRequest(
        `/api/candidates/${candidateId}/cv-extractions`,
        'POST',
        'raw content',
        { 'Content-Type': 'application/octet-stream' },
      ),
      candidateContext(),
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stops an oversized upload at the same-origin boundary', async () => {
    const fetchMock = successfulUpstream();
    vi.stubGlobal('fetch', fetchMock);

    const response = await uploadCv(
      browserRequest(
        `/api/candidates/${candidateId}/cv-extractions`,
        'POST',
        'a'.repeat(2 * 1024 * 1024 + 1),
        {
          'Content-Type': 'text/plain',
          'X-CV-Attempt-Id': attemptId,
        },
      ),
      candidateContext(),
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads a proposal through validated tenant context without mutation headers', async () => {
    const fetchMock = successfulUpstream();
    vi.stubGlobal('fetch', fetchMock);

    const response = await getCv(
      browserRequest(`/api/cv-extractions/${extractionId}`, 'GET'),
      extractionContext(),
    );
    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith(`/api/v1/cv-extractions/${extractionId}`),
    )!;
    const headers = (call[1] as RequestInit).headers as Headers;

    expect(response.status).toBe(200);
    expect(headers.get('X-Tenant-Id')).toBe(membership.tenantId);
    expect(headers.has('Idempotency-Key')).toBe(false);
  });

  it('confirms reviewed values with a stable derived key and bounded backend body', async () => {
    const fetchMock = successfulUpstream();
    vi.stubGlobal('fetch', fetchMock);
    const request = () =>
      browserRequest(
        `/api/cv-extractions/${extractionId}/confirm`,
        'POST',
        JSON.stringify({ attemptId, profile }),
        { 'Content-Type': 'application/json' },
      );

    await confirmCv(request(), extractionContext());
    await confirmCv(request(), extractionContext());
    const calls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith(`/api/v1/cv-extractions/${extractionId}/confirm`),
    );
    const first = calls[0]![1] as RequestInit;
    const second = calls[1]![1] as RequestInit;
    const firstHeaders = first.headers as Headers;

    expect(calls).toHaveLength(2);
    expect(firstHeaders.get('Idempotency-Key')).toMatch(
      /^cv:confirm:[a-f0-9]{64}$/,
    );
    expect((second.headers as Headers).get('Idempotency-Key')).toBe(
      firstHeaders.get('Idempotency-Key'),
    );
    expect(JSON.parse(first.body as string)).toEqual(profile);
  });

  it('rejects caller scope/key fields and sends only an empty rejection body', async () => {
    const fetchMock = successfulUpstream();
    vi.stubGlobal('fetch', fetchMock);

    const invalid = await rejectCv(
      browserRequest(
        `/api/cv-extractions/${extractionId}/reject`,
        'POST',
        JSON.stringify({ attemptId, tenantId: membership.tenantId }),
        { 'Content-Type': 'application/json' },
      ),
      extractionContext(),
    );
    expect(invalid.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();

    const response = await rejectCv(
      browserRequest(
        `/api/cv-extractions/${extractionId}/reject`,
        'POST',
        JSON.stringify({ attemptId }),
        { 'Content-Type': 'application/json' },
      ),
      extractionContext(),
    );
    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith(`/api/v1/cv-extractions/${extractionId}/reject`),
    )!;
    const init = call[1] as RequestInit;

    expect(response.status).toBe(200);
    expect(JSON.parse(init.body as string)).toEqual({});
    expect((init.headers as Headers).get('Idempotency-Key')).toMatch(
      /^cv:reject:[a-f0-9]{64}$/,
    );
  });

  it('preserves neutral denial and clears an expired session', async () => {
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

    const response = await getCv(
      browserRequest(`/api/cv-extractions/${extractionId}`, 'GET'),
      extractionContext(),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toContain(
      'candidate_compliance_session=',
    );
  });
});

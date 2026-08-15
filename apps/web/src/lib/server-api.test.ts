import { membershipListResponseSchema } from '@candidate-compliance/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { requestApi } from './server-api';

const responseBody = {
  memberships: [
    {
      membershipId: '30000000-0000-4000-8000-000000000001',
      tenantId: '10000000-0000-4000-8000-000000000001',
      tenantName: 'Alpha Staffing',
      role: 'ADMIN',
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestApi', () => {
  it('keeps pre-selection membership discovery free of tenant context', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(responseBody, {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await requestApi({
      path: '/api/v1/memberships',
      schema: membershipListResponseSchema,
      token: 'redacted-test-token',
    });

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer redacted-test-token');
    expect(headers.has('X-Tenant-Id')).toBe(false);
  });

  it('attaches a server-validated tenant to tenant-scoped calls', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(responseBody));
    vi.stubGlobal('fetch', fetchMock);

    await requestApi({
      path: '/api/v1/test',
      schema: membershipListResponseSchema,
      token: 'redacted-test-token',
      tenantId: '10000000-0000-4000-8000-000000000001',
    });

    const headers = fetchMock.mock.calls[0]![1]!.headers as Headers;
    expect(headers.get('X-Tenant-Id')).toBe(
      '10000000-0000-4000-8000-000000000001',
    );
  });

  it('does not expose upstream server details through the frontend boundary', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            type: 'about:blank',
            title: 'Internal Server Error',
            status: 500,
            detail: 'Sensitive database connection detail',
          },
          { status: 500 },
        ),
      ),
    );

    await expect(
      requestApi({
        path: '/api/v1/test',
        schema: membershipListResponseSchema,
      }),
    ).rejects.toMatchObject({
      status: 502,
      problem: {
        status: 502,
        detail: 'The service could not complete the request. Please try again.',
      },
    });
  });
});

// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TenantSelector } from './tenant-selector';

const alphaMembership = {
  membershipId: '30000000-0000-4000-8000-000000000001',
  tenantId: '10000000-0000-4000-8000-000000000001',
  tenantName: 'Alpha Staffing',
  role: 'ADMIN',
} as const;
const betaMembership = {
  membershipId: '30000000-0000-4000-8000-000000000002',
  tenantId: '10000000-0000-4000-8000-000000000002',
  tenantName: 'Beta Staffing',
  role: 'RECRUITER',
} as const;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TenantSelector', () => {
  it('shows loading and the zero-membership state explicitly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ memberships: [] })),
    );
    render(<TenantSelector />);

    expect(screen.getByRole('status').textContent).toContain(
      'Loading tenant access',
    );
    expect(await screen.findByText('No tenant access')).toBeTruthy();
  });

  it('selects the sole authorized membership and validates it before entry', async () => {
    const onSelected = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ memberships: [alphaMembership] }))
      .mockResolvedValueOnce(
        Response.json({
          tenantId: alphaMembership.tenantId,
          userId: '20000000-0000-4000-8000-000000000001',
          membershipId: alphaMembership.membershipId,
          role: alphaMembership.role,
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    render(<TenantSelector onSelected={onSelected} />);

    const select = await screen.findByLabelText('Tenant');
    expect((select as HTMLSelectElement).value).toBe(alphaMembership.tenantId);
    fireEvent.submit(screen.getByRole('button').closest('form')!);

    await waitFor(() => expect(onSelected).toHaveBeenCalledOnce());
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({
      tenantId: alphaMembership.tenantId,
    });
  });

  it('offers multiple memberships without allowing a free-form tenant value', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ memberships: [alphaMembership, betaMembership] }),
        ),
    );
    render(<TenantSelector />);

    const select = await screen.findByLabelText('Tenant');
    expect(select.tagName).toBe('SELECT');
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect((select as HTMLSelectElement).value).toBe('');
    expect(screen.getByText(/Only memberships returned/)).toBeTruthy();
  });

  it('hands authentication loss back to the protected-session flow', async () => {
    const onSessionLost = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            type: 'about:blank',
            title: 'Unauthorized',
            status: 401,
            detail: 'Your session is no longer valid. Please sign in again.',
          },
          { status: 401 },
        ),
      ),
    );
    render(<TenantSelector onSessionLost={onSessionLost} />);

    await waitFor(() => expect(onSessionLost).toHaveBeenCalledOnce());
  });

  it('shows a retryable bounded error when discovery is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(<TenantSelector />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Memberships unavailable');
    expect(alert.textContent).toContain('Please try again');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

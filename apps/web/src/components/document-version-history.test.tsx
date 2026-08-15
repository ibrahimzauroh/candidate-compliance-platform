// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DocumentVersionHistory } from './document-version-history';

afterEach(cleanup);

describe('DocumentVersionHistory', () => {
  it('identifies one current version and keeps approved history read-only', () => {
    render(
      <DocumentVersionHistory
        history={{
          items: [
            {
              id: '60000000-0000-4000-8000-000000000001',
              versionNumber: 1,
              issueDate: '2026-08-01',
              expiryDate: '2027-08-01',
              status: 'APPROVED',
              createdAt: '2026-08-15T10:00:00.000Z',
              isCurrent: false,
            },
            {
              id: '60000000-0000-4000-8000-000000000002',
              versionNumber: 2,
              issueDate: '2026-09-01',
              expiryDate: '2028-08-01',
              status: 'DRAFT',
              createdAt: '2026-08-15T11:00:00.000Z',
              isCurrent: true,
            },
          ],
        }}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Version 1' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Version 2' })).toBeTruthy();
    expect(screen.getByText('Current version')).toBeTruthy();
    expect(screen.getByText('Historical version — read-only')).toBeTruthy();
    expect(screen.getByText('Immutable approved version')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('announces loading and shows a bounded unavailable state', () => {
    const { rerender } = render(<DocumentVersionHistory loading />);

    expect(screen.getByRole('status')).toBeTruthy();

    rerender(
      <DocumentVersionHistory error="Version history could not be loaded." />,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(
      screen.getByText('Version history could not be loaded.'),
    ).toBeTruthy();
  });
});

// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ComplianceDocumentDetail } from './compliance-document-detail';

afterEach(cleanup);

describe('ComplianceDocumentDetail', () => {
  it('renders bounded current-version metadata and immutable approval guidance', () => {
    render(
      <ComplianceDocumentDetail
        candidateId="40000000-0000-4000-8000-000000000001"
        document={{
          id: '50000000-0000-4000-8000-000000000001',
          candidateId: '40000000-0000-4000-8000-000000000001',
          type: 'PROFESSIONAL_CERTIFICATION',
          currentVersion: {
            id: '60000000-0000-4000-8000-000000000001',
            versionNumber: 2,
            issueDate: '2026-08-01',
            expiryDate: null,
            status: 'APPROVED',
            createdAt: '2026-08-15T10:00:00.000Z',
          },
          createdAt: '2026-08-14T10:00:00.000Z',
          updatedAt: '2026-08-15T10:00:00.000Z',
        }}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'Professional certification' }),
    ).toBeTruthy();
    expect(screen.getAllByText('Approved').length).toBeGreaterThan(0);
    expect(screen.getByText(/approved versions are immutable/i)).toBeTruthy();
    expect(screen.getByText('Not set')).toBeTruthy();
  });
});

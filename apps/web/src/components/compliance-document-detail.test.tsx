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
    expect(screen.getByText(/approved version is immutable/i)).toBeTruthy();
    expect(screen.getByText('Not set')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Create correction' }),
    ).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: /approve current/i }),
    ).toBeNull();
  });

  it('offers approval only for eligible current states and no invalid action for rejection', () => {
    const baseDocument = {
      id: '50000000-0000-4000-8000-000000000001',
      candidateId: '40000000-0000-4000-8000-000000000001',
      type: 'RIGHT_TO_WORK' as const,
      currentVersion: {
        id: '60000000-0000-4000-8000-000000000001',
        versionNumber: 1,
        issueDate: null,
        expiryDate: null,
        status: 'DRAFT' as const,
        createdAt: '2026-08-15T10:00:00.000Z',
      },
      createdAt: '2026-08-15T10:00:00.000Z',
      updatedAt: '2026-08-15T10:00:00.000Z',
    };
    const { rerender } = render(
      <ComplianceDocumentDetail
        key="draft"
        candidateId={baseDocument.candidateId}
        document={baseDocument}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Approve current version' }),
    ).toBeTruthy();

    rerender(
      <ComplianceDocumentDetail
        key="rejected"
        candidateId={baseDocument.candidateId}
        document={{
          ...baseDocument,
          currentVersion: {
            ...baseDocument.currentVersion,
            status: 'REJECTED',
          },
        }}
      />,
    );

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/cannot be approved or corrected/i)).toBeTruthy();
  });
});

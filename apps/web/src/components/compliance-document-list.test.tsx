// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ComplianceDocumentList } from './compliance-document-list';

afterEach(cleanup);

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

describe('ComplianceDocumentList', () => {
  it('renders current document metadata and a Candidate-scoped view link', () => {
    render(
      <ComplianceDocumentList
        candidateId={candidateId}
        documents={[document]}
      />,
    );

    expect(screen.getByText('Right to Work')).toBeTruthy();
    expect(screen.getByText('Version 1')).toBeTruthy();
    expect(screen.getByText('Draft')).toBeTruthy();
    expect(screen.getByText('01 Aug 2027')).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'View Right to Work' })
        .getAttribute('href'),
    ).toBe(`/candidates/${candidateId}/documents/${document.id}`);
  });

  it('renders distinct empty and safe failure states', () => {
    const { rerender } = render(
      <ComplianceDocumentList candidateId={candidateId} documents={[]} />,
    );

    expect(
      screen.getByRole('heading', { name: 'No compliance documents' }),
    ).toBeTruthy();

    rerender(
      <ComplianceDocumentList
        candidateId={candidateId}
        documents={[]}
        error="permission"
      />,
    );
    expect(screen.getByText(/do not have permission/i)).toBeTruthy();

    rerender(
      <ComplianceDocumentList
        candidateId={candidateId}
        documents={[]}
        error="unavailable"
      />,
    );
    expect(screen.getByText(/could not be loaded/i)).toBeTruthy();
  });
});

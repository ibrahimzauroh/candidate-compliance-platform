// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CandidateDetail } from './candidate-detail';

afterEach(cleanup);

describe('CandidateDetail', () => {
  it('renders only authoritative Candidate metadata and accessible navigation', () => {
    render(
      <CandidateDetail
        candidate={{
          id: '40000000-0000-4000-8000-000000000001',
          fullName: 'Ada Candidate',
          email: 'ada@example.test',
          roleAppliedFor: 'Compliance Engineer',
          createdAt: '2026-08-15T10:00:00.000Z',
          updatedAt: '2026-08-16T11:30:00.000Z',
        }}
      />,
    );

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Ada Candidate',
    );
    expect(screen.getByText('ada@example.test')).toBeTruthy();
    expect(screen.getByText('Compliance Engineer')).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'Back to candidates' })
        .getAttribute('href'),
    ).toBe('/candidates');
    expect(
      screen.getByRole('link', { name: 'Add document' }).getAttribute('href'),
    ).toBe('/candidates/40000000-0000-4000-8000-000000000001/documents/new');
  });
});

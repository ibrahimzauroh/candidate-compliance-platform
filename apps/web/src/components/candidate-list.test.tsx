// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CandidateList } from './candidate-list';

afterEach(cleanup);

describe('CandidateList', () => {
  it('renders the authoritative Candidate fields with mobile-equivalent labels', () => {
    render(
      <CandidateList
        filtered={false}
        candidates={[
          {
            id: '40000000-0000-4000-8000-000000000001',
            fullName: 'Ada Candidate',
            email: 'ada@example.test',
            roleAppliedFor: 'Compliance Engineer',
            createdAt: '2026-08-15T10:00:00.000Z',
            updatedAt: '2026-08-16T10:00:00.000Z',
          },
        ]}
      />,
    );

    expect(screen.getByText('Ada Candidate')).toBeTruthy();
    expect(screen.getByText('ada@example.test')).toBeTruthy();
    expect(screen.getByText('Compliance Engineer')).toBeTruthy();
    expect(screen.getAllByText('Role applied for').length).toBeGreaterThan(0);
    expect(screen.getByText('16 Aug 2026')).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'View Ada Candidate' })
        .getAttribute('href'),
    ).toBe('/candidates/40000000-0000-4000-8000-000000000001');
  });

  it('distinguishes an empty tenant from filtered no results', () => {
    const { rerender } = render(
      <CandidateList candidates={[]} filtered={false} />,
    );

    expect(
      screen.getByRole('heading', { name: 'No active candidates' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add candidate' })).toBeTruthy();

    rerender(<CandidateList candidates={[]} filtered />);

    expect(
      screen.getByRole('heading', { name: 'No matching candidates' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Clear filters' })).toBeTruthy();
  });
});

// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Pagination } from './pagination';

afterEach(cleanup);

describe('Pagination', () => {
  it('preserves filters while exposing accessible previous and next links', () => {
    render(
      <Pagination
        query={{
          page: 2,
          pageSize: 20,
          search: 'ada',
          roleAppliedFor: 'engineer',
        }}
        totalItems={65}
        totalPages={4}
      />,
    );

    const navigation = screen.getByRole('navigation', {
      name: 'Candidate pages',
    });
    const previous = screen.getByRole('link', { name: 'Previous' });
    const next = screen.getByRole('link', { name: 'Next' });

    expect(navigation.textContent).toContain('Page 2 of 4');
    expect(previous.getAttribute('href')).toBe(
      '/candidates?search=ada&roleAppliedFor=engineer',
    );
    expect(next.getAttribute('href')).toBe(
      '/candidates?search=ada&roleAppliedFor=engineer&page=3',
    );
  });

  it('uses non-interactive disabled states at the list boundaries', () => {
    render(
      <Pagination
        query={{ page: 1, pageSize: 20 }}
        totalItems={1}
        totalPages={1}
      />,
    );

    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByText('Previous').getAttribute('aria-disabled')).toBe(
      'true',
    );
    expect(screen.getByText('Next').getAttribute('aria-disabled')).toBe('true');
  });
});

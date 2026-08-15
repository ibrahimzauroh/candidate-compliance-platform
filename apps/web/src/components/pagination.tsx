import type { CandidateListQuery } from '@candidate-compliance/contracts';
import Link from 'next/link';

import { candidateListSearch } from '../lib/candidate-query';

interface PaginationProps {
  query: CandidateListQuery;
  totalItems: number;
  totalPages: number;
}

function hrefFor(query: CandidateListQuery, page: number): string {
  return `/candidates${candidateListSearch({ ...query, page })}`;
}

export function Pagination({ query, totalItems, totalPages }: PaginationProps) {
  if (totalPages === 0) {
    return null;
  }

  const previousPage = Math.max(1, query.page - 1);
  const nextPage = Math.min(totalPages, query.page + 1);

  return (
    <nav className="pagination" aria-label="Candidate pages">
      <p aria-live="polite">
        Page {query.page} of {totalPages} <span>({totalItems} candidates)</span>
      </p>
      <div className="pagination__actions">
        {query.page > 1 ? (
          <Link
            className="button button--secondary"
            href={hrefFor(query, previousPage)}
            rel="prev"
          >
            Previous
          </Link>
        ) : (
          <span className="button button--secondary" aria-disabled="true">
            Previous
          </span>
        )}
        {query.page < totalPages ? (
          <Link
            className="button button--secondary"
            href={hrefFor(query, nextPage)}
            rel="next"
          >
            Next
          </Link>
        ) : (
          <span className="button button--secondary" aria-disabled="true">
            Next
          </span>
        )}
      </div>
    </nav>
  );
}

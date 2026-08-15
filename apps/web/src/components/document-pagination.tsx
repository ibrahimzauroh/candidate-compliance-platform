import Link from 'next/link';

import { documentPageHref } from '../lib/document-query';

interface DocumentPaginationProps {
  candidateId: string;
  page: number;
  totalItems: number;
  totalPages: number;
}

export function DocumentPagination({
  candidateId,
  page,
  totalItems,
  totalPages,
}: DocumentPaginationProps) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <nav className="pagination" aria-label="Compliance document pages">
      <p>
        Page {page} of {totalPages} · {totalItems}{' '}
        {totalItems === 1 ? 'document' : 'documents'}
      </p>
      <div className="pagination__actions">
        {page > 1 ? (
          <Link
            className="button button--secondary"
            href={documentPageHref(candidateId, page - 1)}
          >
            Previous
          </Link>
        ) : (
          <span className="button button--secondary" aria-disabled="true">
            Previous
          </span>
        )}
        {page < totalPages ? (
          <Link
            className="button button--secondary"
            href={documentPageHref(candidateId, page + 1)}
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

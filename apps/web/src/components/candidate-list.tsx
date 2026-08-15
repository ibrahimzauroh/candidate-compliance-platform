import type { Candidate } from '@candidate-compliance/contracts';
import Link from 'next/link';

import { EmptyState } from './empty-state';

interface CandidateListProps {
  candidates: Candidate[];
  filtered: boolean;
}

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

export function CandidateList({ candidates, filtered }: CandidateListProps) {
  if (candidates.length === 0) {
    return filtered ? (
      <EmptyState
        title="No matching candidates"
        description="No active candidates match these search and filter values. Clear the filters to return to the full list."
        action={
          <Link className="button button--secondary" href="/candidates">
            Clear filters
          </Link>
        }
      />
    ) : (
      <EmptyState
        title="No active candidates"
        description="Add the first candidate for this tenant to begin their compliance journey."
        action={
          <Link className="button button--primary" href="/candidates/new">
            Add candidate
          </Link>
        }
      />
    );
  }

  return (
    <section aria-labelledby="candidate-results-title">
      <h2 className="sr-only" id="candidate-results-title">
        Candidate results
      </h2>
      <div className="candidate-list__header" aria-hidden="true">
        <span>Candidate</span>
        <span>Role applied for</span>
        <span>Updated</span>
        <span>Action</span>
      </div>
      <ul className="candidate-list">
        {candidates.map((candidate) => (
          <li key={candidate.id} className="candidate-record">
            <dl className="candidate-record__fields">
              <div className="candidate-record__identity">
                <dt className="sr-only candidate-record__mobile-label">
                  Candidate
                </dt>
                <dd>
                  <Link href={`/candidates/${candidate.id}`}>
                    <strong>{candidate.fullName}</strong>
                  </Link>
                  <span>{candidate.email}</span>
                </dd>
              </div>
              <div>
                <dt className="sr-only candidate-record__mobile-label">
                  Role applied for
                </dt>
                <dd>{candidate.roleAppliedFor}</dd>
              </div>
              <div>
                <dt className="sr-only candidate-record__mobile-label">
                  Updated
                </dt>
                <dd>
                  <time dateTime={candidate.updatedAt}>
                    {dateFormatter.format(new Date(candidate.updatedAt))}
                  </time>
                </dd>
              </div>
              <div className="candidate-record__action">
                <dt className="sr-only">Action</dt>
                <dd>
                  <Link
                    className="button button--quiet"
                    href={`/candidates/${candidate.id}`}
                    aria-label={`View ${candidate.fullName}`}
                  >
                    View
                  </Link>
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}

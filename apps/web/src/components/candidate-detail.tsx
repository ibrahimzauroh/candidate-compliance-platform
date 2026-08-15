import type { Candidate } from '@candidate-compliance/contracts';
import Link from 'next/link';

interface CandidateDetailProps {
  candidate: Candidate;
}

const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

export function CandidateDetail({ candidate }: CandidateDetailProps) {
  return (
    <header className="candidate-detail">
      <Link className="back-link" href="/candidates">
        Back to candidates
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Candidate record</p>
          <h1>{candidate.fullName}</h1>
          <p>
            This record and its compliance documents are scoped to the selected
            tenant by the API.
          </p>
        </div>
        <Link
          className="button button--primary"
          href={`/candidates/${candidate.id}/documents/new`}
        >
          Add document
        </Link>
      </div>
      <dl className="metadata-grid" aria-label="Candidate details">
        <div>
          <dt>Email</dt>
          <dd>
            <a href={`mailto:${candidate.email}`}>{candidate.email}</a>
          </dd>
        </div>
        <div>
          <dt>Role applied for</dt>
          <dd>{candidate.roleAppliedFor}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>
            <time dateTime={candidate.createdAt}>
              {dateTimeFormatter.format(new Date(candidate.createdAt))}
            </time>
          </dd>
        </div>
        <div>
          <dt>Last updated</dt>
          <dd>
            <time dateTime={candidate.updatedAt}>
              {dateTimeFormatter.format(new Date(candidate.updatedAt))}
            </time>
          </dd>
        </div>
      </dl>
    </header>
  );
}

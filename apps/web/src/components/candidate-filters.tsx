import type { CandidateListQuery } from '@candidate-compliance/contracts';
import Link from 'next/link';

interface CandidateFiltersProps {
  query: CandidateListQuery;
}

export function CandidateFilters({ query }: CandidateFiltersProps) {
  const filtered = Boolean(query.search || query.email || query.roleAppliedFor);

  return (
    <form className="candidate-filters" action="/candidates" method="get">
      <div className="field-group candidate-filters__search">
        <label htmlFor="candidate-search">Search candidates</label>
        <input
          id="candidate-search"
          name="search"
          type="search"
          defaultValue={query.search ?? ''}
          maxLength={200}
          placeholder="Name, email or role"
        />
      </div>
      <div className="field-group">
        <label htmlFor="candidate-email-filter">Exact email</label>
        <input
          id="candidate-email-filter"
          name="email"
          type="email"
          defaultValue={query.email ?? ''}
          maxLength={254}
          placeholder="candidate@example.com"
        />
      </div>
      <div className="field-group">
        <label htmlFor="candidate-role-filter">Role contains</label>
        <input
          id="candidate-role-filter"
          name="roleAppliedFor"
          type="search"
          defaultValue={query.roleAppliedFor ?? ''}
          maxLength={200}
          placeholder="Compliance"
        />
      </div>
      <div className="candidate-filters__actions">
        <button className="button button--secondary" type="submit">
          Apply filters
        </button>
        {filtered ? (
          <Link className="button button--quiet" href="/candidates">
            Clear
          </Link>
        ) : null}
      </div>
    </form>
  );
}

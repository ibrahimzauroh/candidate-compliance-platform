import {
  candidateListResponseSchema,
  type CandidateListResponse,
} from '@candidate-compliance/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AlertBanner } from '../../../components/alert-banner';
import { CandidateFilters } from '../../../components/candidate-filters';
import { CandidateList } from '../../../components/candidate-list';
import { Pagination } from '../../../components/pagination';
import {
  candidateApiSearch,
  candidateListSearch,
  parseCandidateQuery,
  type CandidateSearchParams,
} from '../../../lib/candidate-query';
import { ApiRequestError, requestApi } from '../../../lib/server-api';
import { readyTenantSession, sessionToken } from '../../../lib/session';

export const metadata: Metadata = { title: 'Candidates' };

interface CandidatePageProps {
  searchParams: Promise<CandidateSearchParams>;
}

export default async function CandidatesPage({
  searchParams,
}: CandidatePageProps) {
  const rawSearchParams = await searchParams;
  const query = parseCandidateQuery(rawSearchParams);
  let session;

  try {
    session = await readyTenantSession();
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) {
      redirect('/sign-in?reason=session');
    }

    if (error instanceof ApiRequestError && error.status === 403) {
      redirect('/select-tenant');
    }

    throw error;
  }

  const token = await sessionToken();

  if (!session || !token) {
    redirect(token ? '/select-tenant' : '/sign-in?reason=session');
  }

  let result: CandidateListResponse;

  try {
    result = await requestApi({
      path: `/api/v1/candidates?${candidateApiSearch(query)}`,
      schema: candidateListResponseSchema,
      token,
      tenantId: session.tenantContext.tenantId,
    });
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) {
      redirect('/sign-in?reason=session');
    }

    const permissionDenied =
      error instanceof ApiRequestError && error.status === 403;

    return (
      <section
        className="candidate-page"
        aria-labelledby="candidate-page-title"
      >
        <div className="page-heading">
          <div>
            <p className="eyebrow">Tenant workspace</p>
            <h1 id="candidate-page-title">Candidates</h1>
          </div>
        </div>
        <AlertBanner
          title={
            permissionDenied
              ? 'Candidate access unavailable'
              : 'Candidates unavailable'
          }
          tone="error"
        >
          <p>
            {permissionDenied
              ? 'You do not have permission to view candidates in this tenant.'
              : 'The candidate list could not be loaded. Please try again.'}
          </p>
          {!permissionDenied ? (
            <Link
              className="button button--secondary"
              href={`/candidates${candidateListSearch(query)}`}
            >
              Try again
            </Link>
          ) : null}
        </AlertBanner>
      </section>
    );
  }

  if (
    result.pagination.totalPages > 0 &&
    query.page > result.pagination.totalPages
  ) {
    redirect(
      `/candidates${candidateListSearch({
        ...query,
        page: result.pagination.totalPages,
      })}`,
    );
  }

  const filtered = Boolean(query.search || query.email || query.roleAppliedFor);
  const created = rawSearchParams.created === '1';

  return (
    <section className="candidate-page" aria-labelledby="candidate-page-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Tenant workspace</p>
          <h1 id="candidate-page-title">Candidates</h1>
          <p>
            Active records for {session.membership.tenantName}. Search and
            filters are applied by the tenant-scoped API.
          </p>
        </div>
        <Link className="button button--primary" href="/candidates/new">
          Add candidate
        </Link>
      </div>

      {created ? (
        <AlertBanner title="Candidate created" tone="success">
          <p>The candidate was added to this tenant’s active list.</p>
        </AlertBanner>
      ) : null}

      <CandidateFilters query={query} />
      <div
        className="candidate-results-summary"
        role="status"
        aria-live="polite"
      >
        <p>
          {result.pagination.totalItems}{' '}
          {result.pagination.totalItems === 1 ? 'candidate' : 'candidates'}
          {filtered ? ' matching the current filters' : ''}
        </p>
      </div>
      <CandidateList candidates={result.items} filtered={filtered} />
      <Pagination
        query={query}
        totalItems={result.pagination.totalItems}
        totalPages={result.pagination.totalPages}
      />
    </section>
  );
}

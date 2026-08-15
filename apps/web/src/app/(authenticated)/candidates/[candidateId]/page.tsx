import {
  candidateDocumentListResponseSchema,
  candidateIdParamsSchema,
  candidateSchema,
  type Candidate,
  type CandidateDocumentListResponse,
} from '@candidate-compliance/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { AlertBanner } from '../../../../components/alert-banner';
import { CandidateDetail } from '../../../../components/candidate-detail';
import {
  ComplianceDocumentList,
  type DocumentListError,
} from '../../../../components/compliance-document-list';
import { DocumentPagination } from '../../../../components/document-pagination';
import { CvUploadPanel } from '../../../../components/cv-upload-panel';
import {
  documentApiSearch,
  documentPageHref,
  parseDocumentPage,
  type DocumentSearchParams,
} from '../../../../lib/document-query';
import { ApiRequestError, requestApi } from '../../../../lib/server-api';
import { readyTenantSession, sessionToken } from '../../../../lib/session';

export const metadata: Metadata = { title: 'Candidate details' };

interface CandidateDetailPageProps {
  params: Promise<{ candidateId: string }>;
  searchParams: Promise<DocumentSearchParams>;
}

function CandidateAccessError({ permission }: { permission: boolean }) {
  return (
    <section className="candidate-page" aria-labelledby="candidate-error-title">
      <Link className="back-link" href="/candidates">
        Back to candidates
      </Link>
      <h1 id="candidate-error-title">Candidate unavailable</h1>
      <AlertBanner title="Unable to show candidate" tone="error">
        <p>
          {permission
            ? 'You do not have permission to view candidates in this tenant.'
            : 'The candidate could not be loaded. Please try again.'}
        </p>
      </AlertBanner>
    </section>
  );
}

export default async function CandidateDetailPage({
  params,
  searchParams,
}: CandidateDetailPageProps) {
  const parsedParams = candidateIdParamsSchema.safeParse(await params);

  if (!parsedParams.success) {
    notFound();
  }

  const rawSearchParams = await searchParams;
  const documentPage = parseDocumentPage(rawSearchParams);
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

  let candidate: Candidate;

  try {
    candidate = await requestApi({
      path: `/api/v1/candidates/${parsedParams.data.candidateId}`,
      schema: candidateSchema,
      token,
      tenantId: session.tenantContext.tenantId,
    });
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) {
      redirect('/sign-in?reason=session');
    }

    if (error instanceof ApiRequestError && error.status === 404) {
      notFound();
    }

    return (
      <CandidateAccessError
        permission={error instanceof ApiRequestError && error.status === 403}
      />
    );
  }

  let documents: CandidateDocumentListResponse | null = null;
  let documentError: DocumentListError | undefined;

  try {
    documents = await requestApi({
      path: `/api/v1/candidates/${candidate.id}/documents?${documentApiSearch(documentPage)}`,
      schema: candidateDocumentListResponseSchema,
      token,
      tenantId: session.tenantContext.tenantId,
    });
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) {
      redirect('/sign-in?reason=session');
    }

    if (error instanceof ApiRequestError && error.status === 404) {
      notFound();
    }

    documentError =
      error instanceof ApiRequestError && error.status === 403
        ? 'permission'
        : 'unavailable';
  }

  if (
    documents &&
    documents.pagination.totalPages > 0 &&
    documentPage > documents.pagination.totalPages
  ) {
    redirect(documentPageHref(candidate.id, documents.pagination.totalPages));
  }

  return (
    <article className="candidate-detail-page">
      <CandidateDetail candidate={candidate} />

      <CvUploadPanel candidateId={candidate.id} />

      {rawSearchParams.documentCreated === '1' ? (
        <AlertBanner title="Compliance document created" tone="success">
          <p>The new document is available below as a draft.</p>
        </AlertBanner>
      ) : null}

      <section
        className="candidate-documents"
        aria-labelledby="candidate-documents-title"
      >
        <div className="section-heading">
          <div>
            <p className="section-label">Current records</p>
            <h2 id="candidate-documents-title">Compliance documents</h2>
          </div>
          {documents ? (
            <p aria-live="polite">
              {documents.pagination.totalItems}{' '}
              {documents.pagination.totalItems === 1 ? 'document' : 'documents'}
            </p>
          ) : null}
        </div>
        <ComplianceDocumentList
          candidateId={candidate.id}
          documents={documents?.items ?? []}
          error={documentError}
        />
        {documents ? (
          <DocumentPagination
            candidateId={candidate.id}
            page={documents.pagination.page}
            totalItems={documents.pagination.totalItems}
            totalPages={documents.pagination.totalPages}
          />
        ) : null}
      </section>
    </article>
  );
}

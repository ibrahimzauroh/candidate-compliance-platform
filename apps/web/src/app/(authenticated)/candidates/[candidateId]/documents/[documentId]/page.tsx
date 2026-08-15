import {
  candidateIdParamsSchema,
  complianceDocumentSchema,
  complianceDocumentVersionHistoryResponseSchema,
  documentIdParamsSchema,
  type ComplianceDocument,
  type ComplianceDocumentVersionHistoryResponse,
} from '@candidate-compliance/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { AlertBanner } from '../../../../../../components/alert-banner';
import { ComplianceDocumentDetail } from '../../../../../../components/compliance-document-detail';
import { ApiRequestError, requestApi } from '../../../../../../lib/server-api';
import {
  readyTenantSession,
  sessionToken,
} from '../../../../../../lib/session';

export const metadata: Metadata = { title: 'Compliance document' };

interface DocumentDetailPageProps {
  params: Promise<{ candidateId: string; documentId: string }>;
}

export default async function DocumentDetailPage({
  params,
}: DocumentDetailPageProps) {
const rawParams = await params;

const candidateParams = candidateIdParamsSchema.safeParse({
  candidateId: rawParams.candidateId,
});

const documentParams = documentIdParamsSchema.safeParse({
  documentId: rawParams.documentId,
});

  if (!candidateParams.success || !documentParams.success) {
    notFound();
  }

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

  let document: ComplianceDocument;

  try {
    document = await requestApi({
      path: `/api/v1/documents/${documentParams.data.documentId}`,
      schema: complianceDocumentSchema,
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
      <section aria-labelledby="document-error-title">
        <Link
          className="back-link"
          href={`/candidates/${candidateParams.data.candidateId}`}
        >
          Back to candidate
        </Link>
        <h1 id="document-error-title">Document unavailable</h1>
        <AlertBanner title="Unable to show document" tone="error">
          <p>
            {error instanceof ApiRequestError && error.status === 403
              ? 'You do not have permission to view compliance documents in this tenant.'
              : 'The document could not be loaded. Please try again.'}
          </p>
        </AlertBanner>
      </section>
    );
  }

  if (document.candidateId !== candidateParams.data.candidateId) {
    notFound();
  }

  let history: ComplianceDocumentVersionHistoryResponse | undefined;
  let historyError: string | null = null;

  try {
    history = await requestApi({
      path: `/api/v1/documents/${documentParams.data.documentId}/versions`,
      schema: complianceDocumentVersionHistoryResponseSchema,
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

    historyError =
      error instanceof ApiRequestError && error.status === 403
        ? 'You do not have permission to view version history in this tenant.'
        : 'Version history could not be loaded. Reload the page to try again.';
  }

  return (
    <ComplianceDocumentDetail
      candidateId={candidateParams.data.candidateId}
      document={document}
      history={history}
      historyError={historyError}
    />
  );
}

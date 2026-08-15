import {
  candidateIdParamsSchema,
  candidateSchema,
} from '@candidate-compliance/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { AlertBanner } from '../../../../../../components/alert-banner';
import { ComplianceDocumentForm } from '../../../../../../components/compliance-document-form';
import { ApiRequestError, requestApi } from '../../../../../../lib/server-api';
import {
  readyTenantSession,
  sessionToken,
} from '../../../../../../lib/session';

export const metadata: Metadata = { title: 'Add compliance document' };

interface AddDocumentPageProps {
  params: Promise<{ candidateId: string }>;
}

export default async function AddDocumentPage({
  params,
}: AddDocumentPageProps) {
  const rawParams = await params;

  const parsedParams = candidateIdParamsSchema.safeParse({
    candidateId: rawParams.candidateId,
  });

  if (!parsedParams.success) {
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

  try {
    await requestApi({
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
      <section aria-labelledby="document-create-error-title">
        <Link
          className="back-link"
          href={`/candidates/${parsedParams.data.candidateId}`}
        >
          Back to candidate
        </Link>
        <h1 id="document-create-error-title">Add document unavailable</h1>
        <AlertBanner title="Unable to prepare document" tone="error">
          <p>
            {error instanceof ApiRequestError && error.status === 403
              ? 'You do not have permission to access this Candidate in the selected tenant.'
              : 'The Candidate could not be loaded. Please try again.'}
          </p>
        </AlertBanner>
      </section>
    );
  }

  return (
    <section
      className="candidate-create-page"
      aria-labelledby="document-create-title"
    >
      <Link
        className="back-link"
        href={`/candidates/${parsedParams.data.candidateId}`}
      >
        Back to candidate
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">New compliance record</p>
          <h1 id="document-create-title">Add document</h1>
          <p>
            Create the document metadata and its first draft version. Approval
            remains a separate governed operation.
          </p>
        </div>
      </div>
      <div className="candidate-form-card">
        <ComplianceDocumentForm candidateId={parsedParams.data.candidateId} />
      </div>
    </section>
  );
}

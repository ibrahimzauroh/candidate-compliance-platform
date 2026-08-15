import {
  candidateIdParamsSchema,
  cvExtractionIdParamsSchema,
  cvExtractionSchema,
  type CvExtraction,
} from '@candidate-compliance/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { AlertBanner } from '../../../../../../components/alert-banner';
import { CvProposalReview } from '../../../../../../components/cv-proposal-review';
import { ApiRequestError, requestApi } from '../../../../../../lib/server-api';
import {
  readyTenantSession,
  sessionToken,
} from '../../../../../../lib/session';

export const metadata: Metadata = { title: 'Review CV proposal' };

interface CvProposalPageProps {
  params: Promise<{ candidateId: string; extractionId: string }>;
}

export default async function CvProposalPage({ params }: CvProposalPageProps) {
  const rawParams = await params;
  const candidateParams = candidateIdParamsSchema.safeParse(rawParams);
  const extractionParams = cvExtractionIdParamsSchema.safeParse(rawParams);

  if (!candidateParams.success || !extractionParams.success) {
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

  let extraction: CvExtraction;

  try {
    extraction = await requestApi({
      path: `/api/v1/cv-extractions/${extractionParams.data.extractionId}`,
      schema: cvExtractionSchema,
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
      <section aria-labelledby="cv-error-title">
        <Link
          className="back-link"
          href={`/candidates/${candidateParams.data.candidateId}`}
        >
          Back to candidate
        </Link>
        <h1 id="cv-error-title">CV proposal unavailable</h1>
        <AlertBanner title="Unable to show CV proposal" tone="error">
          <p>
            {error instanceof ApiRequestError && error.status === 403
              ? 'You do not have permission to review CV proposals in this tenant.'
              : 'The CV proposal could not be loaded. Please try again.'}
          </p>
        </AlertBanner>
      </section>
    );
  }

  if (extraction.candidateId !== candidateParams.data.candidateId) {
    notFound();
  }

  return (
    <CvProposalReview
      candidateId={candidateParams.data.candidateId}
      extraction={extraction}
    />
  );
}

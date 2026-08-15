'use client';

import {
  complianceDocumentVersionHistoryResponseSchema,
  type ComplianceDocument,
  type ComplianceDocumentVersionHistoryResponse,
} from '@candidate-compliance/contracts';
import Link from 'next/link';
import { useState } from 'react';

import { FrontendRequestError, requestFrontend } from '../lib/frontend-api';
import { AlertBanner } from './alert-banner';
import { Button } from './button';
import { documentTypeLabel } from './compliance-document-list';
import { DocumentApprovalControl } from './document-approval-control';
import { DocumentCorrectionForm } from './document-correction-form';
import { DocumentVersionHistory } from './document-version-history';
import { StatusBadge } from './status-badge';

interface ComplianceDocumentDetailProps {
  candidateId: string;
  document: ComplianceDocument;
  history?: ComplianceDocumentVersionHistoryResponse;
  historyError?: string | null;
  onSessionLost?: () => void;
}

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

function optionalDate(value: string | null): string {
  return value
    ? dateFormatter.format(new Date(`${value}T00:00:00Z`))
    : 'Not set';
}

function defaultSessionLostTransition(): void {
  window.location.assign('/sign-in?reason=session');
}

export function ComplianceDocumentDetail({
  candidateId,
  document: initialDocument,
  history: initialHistory,
  historyError: initialHistoryError = null,
  onSessionLost = defaultSessionLostTransition,
}: ComplianceDocumentDetailProps) {
  const [document, setDocument] = useState(initialDocument);
  const [history, setHistory] = useState(initialHistory);
  const [historyError, setHistoryError] = useState(initialHistoryError);
  const [refreshingHistory, setRefreshingHistory] = useState(false);
  const [showCorrection, setShowCorrection] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  async function refreshHistory(): Promise<void> {
    setHistory(undefined);
    setHistoryError(null);
    setRefreshingHistory(true);

    try {
      const nextHistory = await requestFrontend(
        `/api/documents/${document.id}/versions`,
        complianceDocumentVersionHistoryResponseSchema,
      );
      setHistory(nextHistory);
    } catch (caught) {
      if (
        caught instanceof FrontendRequestError &&
        caught.problem.status === 401
      ) {
        onSessionLost();
        return;
      }

      setHistoryError(
        caught instanceof FrontendRequestError && caught.problem.status === 403
          ? 'You do not have permission to view version history in this tenant.'
          : 'Version history could not be refreshed. Reload the page to try again.',
      );
    } finally {
      setRefreshingHistory(false);
    }
  }

  function approved(nextDocument: ComplianceDocument): void {
    setDocument(nextDocument);
    setShowCorrection(false);
    setSuccess(
      nextDocument.currentVersion.status === 'APPROVED'
        ? 'The current version is approved and immutable.'
        : 'The approval request completed. Review the authoritative status below.',
    );
    void refreshHistory();
  }

  function corrected(nextDocument: ComplianceDocument): void {
    setDocument(nextDocument);
    setShowCorrection(false);
    setSuccess(
      'A new draft version was created. The prior approved version remains immutable.',
    );
    void refreshHistory();
  }

  const status = document.currentVersion.status;
  const canApprove = status === 'DRAFT' || status === 'PENDING_REVIEW';
  const canCorrect = status === 'APPROVED';

  return (
    <section className="document-detail-page">
      <Link className="back-link" href={`/candidates/${candidateId}`}>
        Back to candidate
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Compliance document</p>
          <h1>{documentTypeLabel(document.type)}</h1>
          <p>
            Review the authoritative current version and its governed, read-only
            history.
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      {success ? (
        <AlertBanner title="Lifecycle updated" tone="success">
          <p>{success}</p>
        </AlertBanner>
      ) : null}

      <dl className="metadata-grid metadata-grid--document">
        <div>
          <dt>Current version</dt>
          <dd>{document.currentVersion.versionNumber}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{status.replace('_', ' ')}</dd>
        </div>
        <div>
          <dt>Issue date</dt>
          <dd>{optionalDate(document.currentVersion.issueDate)}</dd>
        </div>
        <div>
          <dt>Expiry date</dt>
          <dd>{optionalDate(document.currentVersion.expiryDate)}</dd>
        </div>
        <div>
          <dt>Version created</dt>
          <dd>
            <time dateTime={document.currentVersion.createdAt}>
              {dateTimeFormatter.format(
                new Date(document.currentVersion.createdAt),
              )}
            </time>
          </dd>
        </div>
        <div>
          <dt>Document updated</dt>
          <dd>
            <time dateTime={document.updatedAt}>
              {dateTimeFormatter.format(new Date(document.updatedAt))}
            </time>
          </dd>
        </div>
      </dl>

      <section className="document-lifecycle" aria-labelledby="lifecycle-title">
        <div className="section-heading">
          <div>
            <p className="section-label">Lifecycle action</p>
            <h2 id="lifecycle-title">Govern current version</h2>
          </div>
        </div>
        {status === 'APPROVED' ? (
          <p className="integrity-note">
            This approved version is immutable. A correction creates a new draft
            version and preserves this record in history.
          </p>
        ) : null}
        {canApprove ? (
          <DocumentApprovalControl
            documentId={document.id}
            onApproved={approved}
            onSessionLost={onSessionLost}
          />
        ) : null}
        {canCorrect && !showCorrection ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => setShowCorrection(true)}
          >
            Create correction
          </Button>
        ) : null}
        {canCorrect && showCorrection ? (
          <DocumentCorrectionForm
            document={document}
            onCancel={() => setShowCorrection(false)}
            onCorrected={corrected}
            onSessionLost={onSessionLost}
          />
        ) : null}
        {status === 'REJECTED' ? (
          <p className="field-hint">
            Rejected versions cannot be approved or corrected through this
            workflow.
          </p>
        ) : null}
      </section>

      <DocumentVersionHistory
        history={history}
        error={historyError}
        loading={refreshingHistory}
      />
    </section>
  );
}

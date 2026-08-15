'use client';

import {
  complianceDocumentSchema,
  type ComplianceDocument,
} from '@candidate-compliance/contracts';
import { useEffect, useRef, useState } from 'react';

import { FrontendRequestError, requestFrontend } from '../lib/frontend-api';
import { AlertBanner } from './alert-banner';
import { Button } from './button';

interface DocumentApprovalControlProps {
  createAttemptId?: () => string;
  documentId: string;
  onApproved: (document: ComplianceDocument) => void;
  onSessionLost?: () => void;
}

function defaultAttemptId(): string {
  return globalThis.crypto.randomUUID();
}

function defaultSessionLostTransition(): void {
  window.location.assign('/sign-in?reason=session');
}

export function DocumentApprovalControl({
  createAttemptId = defaultAttemptId,
  documentId,
  onApproved,
  onSessionLost = defaultSessionLostTransition,
}: DocumentApprovalControlProps) {
  const [attemptId] = useState(createAttemptId);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const submissionInProgress = useRef(false);
  const restoreTriggerFocus = useRef(false);

  useEffect(() => {
    if (confirming) {
      confirmRef.current?.focus();
    } else if (restoreTriggerFocus.current) {
      triggerRef.current?.focus();
      restoreTriggerFocus.current = false;
    }
  }, [confirming]);

  function cancel(): void {
    restoreTriggerFocus.current = true;
    setConfirming(false);
    setError(null);
  }

  async function approve(): Promise<void> {
    if (submissionInProgress.current) {
      return;
    }

    submissionInProgress.current = true;
    setSubmitting(true);
    setError(null);
    setStatus('Approving the current document version.');

    try {
      const document = await requestFrontend(
        `/api/documents/${documentId}/approve`,
        complianceDocumentSchema,
        {
          method: 'POST',
          body: JSON.stringify({ attemptId }),
        },
      );
      setStatus(
        'Document approved. The authoritative lifecycle record is refreshing.',
      );
      onApproved(document);
    } catch (caught) {
      if (
        caught instanceof FrontendRequestError &&
        caught.problem.status === 401
      ) {
        setStatus('Your session has expired.');
        onSessionLost();
        return;
      }

      setError(
        caught instanceof FrontendRequestError && caught.problem.status === 403
          ? 'You do not have permission to approve this document.'
          : caught instanceof FrontendRequestError &&
              caught.problem.status === 404
            ? 'This document is no longer available in the selected tenant.'
            : caught instanceof FrontendRequestError &&
                caught.problem.status === 409
              ? 'The current document state cannot be approved. Refresh and review its latest status.'
              : 'The document could not be approved. Please try again.',
      );
      setStatus('Document approval failed. No local state was changed.');
    } finally {
      submissionInProgress.current = false;
      setSubmitting(false);
    }
  }

  if (!confirming) {
    return (
      <Button
        ref={triggerRef}
        type="button"
        onClick={() => setConfirming(true)}
      >
        Approve current version
      </Button>
    );
  }

  return (
    <div
      className="approval-confirmation"
      role="group"
      aria-labelledby="approval-confirmation-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !submitting) {
          cancel();
        }
      }}
    >
      <h3 id="approval-confirmation-title">Approve this version?</h3>
      <p>
        Approval makes this version immutable. Later changes require a governed
        correction that creates a new version.
      </p>
      {error ? (
        <AlertBanner title="Unable to approve document" tone="error">
          <p>{error}</p>
        </AlertBanner>
      ) : null}
      <div className="button-row">
        <Button
          ref={confirmRef}
          type="button"
          loading={submitting}
          onClick={approve}
        >
          {submitting ? 'Approving version' : 'Confirm approval'}
        </Button>
        <Button
          type="button"
          variant="quiet"
          disabled={submitting}
          onClick={cancel}
        >
          Cancel
        </Button>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}

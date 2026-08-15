'use client';

import {
  complianceDocumentSchema,
  correctComplianceDocumentRequestSchema,
  type ComplianceDocument,
  type CorrectComplianceDocumentRequest,
} from '@candidate-compliance/contracts';
import {
  type ChangeEvent,
  type FormEvent,
  useId,
  useRef,
  useState,
} from 'react';

import { FrontendRequestError, requestFrontend } from '../lib/frontend-api';
import { AlertBanner } from './alert-banner';
import { Button } from './button';

type CorrectionField = 'issueDate' | 'expiryDate';
type CorrectionFieldErrors = Partial<Record<CorrectionField, string>>;

interface DocumentCorrectionFormProps {
  createAttemptId?: () => string;
  document: ComplianceDocument;
  onCancel: () => void;
  onCorrected: (document: ComplianceDocument) => void;
  onSessionLost?: () => void;
}

function defaultAttemptId(): string {
  return globalThis.crypto.randomUUID();
}

function defaultSessionLostTransition(): void {
  window.location.assign('/sign-in?reason=session');
}

function correctionInput(
  values: Record<CorrectionField, string>,
): CorrectComplianceDocumentRequest {
  return {
    issueDate: values.issueDate || null,
    expiryDate: values.expiryDate || null,
  };
}

function fieldErrorsFromIssues(
  issues: readonly { path: PropertyKey[]; message: string }[],
): CorrectionFieldErrors {
  const errors: CorrectionFieldErrors = {};

  for (const issue of issues) {
    const field = issue.path[0];

    if (field === 'issueDate' || field === 'expiryDate') {
      errors[field] ??= issue.message;
    }
  }

  return errors;
}

export function DocumentCorrectionForm({
  createAttemptId = defaultAttemptId,
  document,
  onCancel,
  onCorrected,
  onSessionLost = defaultSessionLostTransition,
}: DocumentCorrectionFormProps) {
  const issueDateId = useId();
  const expiryDateId = useId();
  const [attemptId] = useState(createAttemptId);
  const [values, setValues] = useState({
    issueDate: document.currentVersion.issueDate ?? '',
    expiryDate: document.currentVersion.expiryDate ?? '',
  });
  const [fieldErrors, setFieldErrors] = useState<CorrectionFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState('');
  const submissionInProgress = useRef(false);

  function updateField(
    field: CorrectionField,
    event: ChangeEvent<HTMLInputElement>,
  ): void {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setFormError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (submissionInProgress.current) {
      return;
    }

    const parsed = correctComplianceDocumentRequestSchema.safeParse(
      correctionInput(values),
    );

    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromIssues(parsed.error.issues));
      setFormError('Check the highlighted fields and try again.');
      setStatus('Correction form validation failed.');
      return;
    }

    submissionInProgress.current = true;
    setSubmitting(true);
    setFieldErrors({});
    setFormError(null);
    setStatus('Creating a corrected document version.');

    try {
      const corrected = await requestFrontend(
        `/api/documents/${document.id}/corrections`,
        complianceDocumentSchema,
        {
          method: 'POST',
          body: JSON.stringify({ attemptId, correction: parsed.data }),
        },
      );
      setStatus('Correction created. The new draft version is refreshing.');
      onCorrected(corrected);
    } catch (caught) {
      if (
        caught instanceof FrontendRequestError &&
        caught.problem.status === 401
      ) {
        setStatus('Your session has expired.');
        onSessionLost();
        return;
      }

      if (caught instanceof FrontendRequestError) {
        const serverFields = fieldErrorsFromIssues(
          (caught.problem.errors ?? []).map((error) => ({
            path: error.path.split('.'),
            message: error.message,
          })),
        );
        setFieldErrors(serverFields);
        setFormError(
          caught.problem.status === 403
            ? 'You do not have permission to correct this document.'
            : caught.problem.status === 404
              ? 'This document is no longer available in the selected tenant.'
              : caught.problem.status === 409
                ? 'The current version is no longer eligible for correction. Refresh and review its latest status.'
                : Object.keys(serverFields).length > 0
                  ? 'Check the highlighted fields and try again.'
                  : 'The correction could not be created. Please try again.',
        );
      } else {
        setFormError('The correction could not be created. Please try again.');
      }
      setStatus('Correction failed. Your entered values were kept.');
    } finally {
      submissionInProgress.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form className="correction-form" onSubmit={submit} noValidate>
      <div>
        <h3>Create a correction</h3>
        <p>
          This creates a new draft version. It never edits the approved version
          in place.
        </p>
      </div>
      {formError ? (
        <AlertBanner title="Unable to create correction" tone="error">
          <p>{formError}</p>
        </AlertBanner>
      ) : null}
      <div className="document-date-fields">
        <div className="field-group">
          <label htmlFor={issueDateId}>Issue date</label>
          <input
            id={issueDateId}
            name="issueDate"
            type="date"
            value={values.issueDate}
            onChange={(event) => updateField('issueDate', event)}
            disabled={submitting}
            aria-invalid={fieldErrors.issueDate ? 'true' : undefined}
            aria-describedby={
              fieldErrors.issueDate ? `${issueDateId}-error` : undefined
            }
          />
          {fieldErrors.issueDate ? (
            <p className="field-error" id={`${issueDateId}-error`}>
              {fieldErrors.issueDate}
            </p>
          ) : null}
        </div>
        <div className="field-group">
          <label htmlFor={expiryDateId}>Expiry date</label>
          <input
            id={expiryDateId}
            name="expiryDate"
            type="date"
            value={values.expiryDate}
            onChange={(event) => updateField('expiryDate', event)}
            disabled={submitting}
            aria-invalid={fieldErrors.expiryDate ? 'true' : undefined}
            aria-describedby={
              fieldErrors.expiryDate ? `${expiryDateId}-error` : undefined
            }
          />
          {fieldErrors.expiryDate ? (
            <p className="field-error" id={`${expiryDateId}-error`}>
              {fieldErrors.expiryDate}
            </p>
          ) : null}
        </div>
      </div>
      <div className="candidate-form__actions">
        <Button type="submit" loading={submitting}>
          {submitting ? 'Creating correction' : 'Create new draft version'}
        </Button>
        <Button
          type="button"
          variant="quiet"
          disabled={submitting}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
    </form>
  );
}

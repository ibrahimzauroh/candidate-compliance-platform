'use client';

import {
  complianceDocumentSchema,
  createComplianceDocumentRequestSchema,
  type ComplianceDocument,
  type CreateComplianceDocumentRequest,
} from '@candidate-compliance/contracts';
import Link from 'next/link';
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

type DocumentField = 'type' | 'issueDate' | 'expiryDate';
type DocumentFieldErrors = Partial<Record<DocumentField, string>>;

interface ComplianceDocumentFormProps {
  candidateId: string;
  createAttemptId?: () => string;
  onCreated?: (document: ComplianceDocument) => void;
  onSessionLost?: () => void;
}

interface DocumentFormValues {
  type: CreateComplianceDocumentRequest['type'];
  issueDate: string;
  expiryDate: string;
}

const emptyValues: DocumentFormValues = {
  type: 'RIGHT_TO_WORK',
  issueDate: '',
  expiryDate: '',
};

const documentTypes: ReadonlyArray<{
  value: CreateComplianceDocumentRequest['type'];
  label: string;
}> = [
  { value: 'RIGHT_TO_WORK', label: 'Right to Work' },
  { value: 'BACKGROUND_CHECK', label: 'Background check' },
  {
    value: 'PROFESSIONAL_CERTIFICATION',
    label: 'Professional certification',
  },
  { value: 'OTHER', label: 'Other' },
];

function defaultAttemptId(): string {
  return globalThis.crypto.randomUUID();
}

function defaultSessionLostTransition(): void {
  window.location.assign('/sign-in?reason=session');
}

function documentInput(
  values: DocumentFormValues,
): CreateComplianceDocumentRequest {
  return {
    type: values.type,
    ...(values.issueDate ? { issueDate: values.issueDate } : {}),
    ...(values.expiryDate ? { expiryDate: values.expiryDate } : {}),
  };
}

function fieldErrorsFromIssues(
  issues: readonly { path: PropertyKey[]; message: string }[],
): DocumentFieldErrors {
  const errors: DocumentFieldErrors = {};

  for (const issue of issues) {
    const field = issue.path[0];

    if (field === 'type' || field === 'issueDate' || field === 'expiryDate') {
      errors[field] ??= issue.message;
    }
  }

  return errors;
}

function safeServerFieldErrors(
  errors: { path: string; message: string }[] | undefined,
): DocumentFieldErrors {
  if (!errors) {
    return {};
  }

  return fieldErrorsFromIssues(
    errors.map((error) => ({
      path: error.path.split('.'),
      message: error.message,
    })),
  );
}

export function ComplianceDocumentForm({
  candidateId,
  createAttemptId = defaultAttemptId,
  onCreated,
  onSessionLost = defaultSessionLostTransition,
}: ComplianceDocumentFormProps) {
  const typeId = useId();
  const issueDateId = useId();
  const expiryDateId = useId();
  const [attemptId] = useState(createAttemptId);
  const [values, setValues] = useState(emptyValues);
  const [fieldErrors, setFieldErrors] = useState<DocumentFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState('');
  const submissionInProgress = useRef(false);

  function updateField(
    field: DocumentField,
    event: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
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

    const parsed = createComplianceDocumentRequestSchema.safeParse(
      documentInput(values),
    );

    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromIssues(parsed.error.issues));
      setFormError('Check the highlighted fields and try again.');
      setStatus('Document form validation failed.');
      return;
    }

    submissionInProgress.current = true;
    setSubmitting(true);
    setFieldErrors({});
    setFormError(null);
    setStatus('Creating compliance document.');

    try {
      const document = await requestFrontend(
        `/api/candidates/${candidateId}/documents`,
        complianceDocumentSchema,
        {
          method: 'POST',
          body: JSON.stringify({ attemptId, document: parsed.data }),
        },
      );
      setStatus('Compliance document created. Returning to the candidate.');

      if (onCreated) {
        onCreated(document);
      } else {
        window.location.assign(`/candidates/${candidateId}?documentCreated=1`);
      }
    } catch (error) {
      if (
        error instanceof FrontendRequestError &&
        error.problem.status === 401
      ) {
        setStatus('Your session has expired.');
        onSessionLost();
        return;
      }

      if (error instanceof FrontendRequestError) {
        const nextFieldErrors = safeServerFieldErrors(error.problem.errors);
        setFieldErrors(nextFieldErrors);
        setFormError(
          error.problem.status === 403
            ? 'You do not have permission to add a document in this tenant.'
            : error.problem.status === 404
              ? 'This candidate is no longer available in the selected tenant.'
              : Object.keys(nextFieldErrors).length > 0
                ? 'Check the highlighted fields and try again.'
                : 'The document could not be created. Please try again.',
        );
      } else {
        setFormError('The document could not be created. Please try again.');
      }

      setStatus('Document creation failed. Your entered values were kept.');
    } finally {
      submissionInProgress.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form className="candidate-form" onSubmit={submit} noValidate>
      {formError ? (
        <AlertBanner title="Unable to create document" tone="error">
          <p>{formError}</p>
        </AlertBanner>
      ) : null}

      <div className="field-group">
        <label htmlFor={typeId}>Document type</label>
        <select
          id={typeId}
          name="type"
          value={values.type}
          onChange={(event) => updateField('type', event)}
          disabled={submitting}
          aria-invalid={fieldErrors.type ? 'true' : undefined}
          aria-describedby={fieldErrors.type ? `${typeId}-error` : undefined}
        >
          {documentTypes.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
        {fieldErrors.type ? (
          <p className="field-error" id={`${typeId}-error`}>
            {fieldErrors.type}
          </p>
        ) : null}
      </div>

      <div className="document-date-fields">
        <div className="field-group">
          <label htmlFor={issueDateId}>Issue date (optional)</label>
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
          <label htmlFor={expiryDateId}>Expiry date (optional)</label>
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

      <p className="field-hint">
        This creates a draft metadata record. File upload and approval are not
        part of this workflow.
      </p>

      <div className="candidate-form__actions">
        <Button type="submit" loading={submitting}>
          {submitting ? 'Creating document' : 'Create document'}
        </Button>
        <Link
          className="button button--quiet"
          href={`/candidates/${candidateId}`}
        >
          Cancel
        </Link>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
    </form>
  );
}

'use client';

import {
  candidateSchema,
  createCandidateRequestSchema,
  type Candidate,
  type CreateCandidateRequest,
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

type CandidateField = keyof CreateCandidateRequest;
type CandidateFieldErrors = Partial<Record<CandidateField, string>>;

interface CandidateFormProps {
  createAttemptId?: () => string;
  onCreated?: (candidate: Candidate) => void;
  onSessionLost?: () => void;
}

const emptyValues: CreateCandidateRequest = {
  fullName: '',
  email: '',
  roleAppliedFor: '',
};

function defaultCreatedTransition(): void {
  window.location.assign('/candidates?created=1');
}

function defaultSessionLostTransition(): void {
  window.location.assign('/sign-in?reason=session');
}

function defaultAttemptId(): string {
  return globalThis.crypto.randomUUID();
}

function fieldErrorsFromIssues(
  issues: readonly { path: PropertyKey[]; message: string }[],
): CandidateFieldErrors {
  const errors: CandidateFieldErrors = {};

  for (const issue of issues) {
    const field = issue.path[0];

    if (
      field === 'fullName' ||
      field === 'email' ||
      field === 'roleAppliedFor'
    ) {
      errors[field] ??= issue.message;
    }
  }

  return errors;
}

function safeServerFieldErrors(
  errors: { path: string; message: string }[] | undefined,
): CandidateFieldErrors {
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

export function CandidateForm({
  createAttemptId = defaultAttemptId,
  onCreated = defaultCreatedTransition,
  onSessionLost = defaultSessionLostTransition,
}: CandidateFormProps) {
  const fullNameId = useId();
  const emailId = useId();
  const roleId = useId();
  const [attemptId] = useState(createAttemptId);
  const [values, setValues] = useState(emptyValues);
  const [fieldErrors, setFieldErrors] = useState<CandidateFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState('');
  const submissionInProgress = useRef(false);

  function updateField(
    field: CandidateField,
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

    const parsed = createCandidateRequestSchema.safeParse(values);

    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromIssues(parsed.error.issues));
      setFormError('Check the highlighted fields and try again.');
      setStatus('Candidate form validation failed.');
      return;
    }

    submissionInProgress.current = true;
    setSubmitting(true);
    setFieldErrors({});
    setFormError(null);
    setStatus('Creating candidate.');

    try {
      const candidate = await requestFrontend(
        '/api/candidates',
        candidateSchema,
        {
          method: 'POST',
          body: JSON.stringify({ attemptId, candidate: parsed.data }),
        },
      );
      setStatus('Candidate created. Returning to the candidate list.');
      onCreated(candidate);
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
            ? 'You do not have permission to add a candidate in this tenant.'
            : error.problem.status === 409
              ? 'A candidate with this email already exists in this tenant.'
              : Object.keys(nextFieldErrors).length > 0
                ? 'Check the highlighted fields and try again.'
                : 'The candidate could not be created. Please try again.',
        );
      } else {
        setFormError('The candidate could not be created. Please try again.');
      }

      setStatus('Candidate creation failed. Your entered values were kept.');
    } finally {
      submissionInProgress.current = false;
      setSubmitting(false);
    }
  }

  return (
    <form className="candidate-form" onSubmit={submit} noValidate>
      {formError ? (
        <AlertBanner title="Unable to create candidate" tone="error">
          <p>{formError}</p>
        </AlertBanner>
      ) : null}

      <div className="field-group">
        <label htmlFor={fullNameId}>Full name</label>
        <input
          id={fullNameId}
          name="fullName"
          type="text"
          autoComplete="name"
          value={values.fullName}
          onChange={(event) => updateField('fullName', event)}
          maxLength={200}
          disabled={submitting}
          aria-invalid={fieldErrors.fullName ? 'true' : undefined}
          aria-describedby={
            fieldErrors.fullName ? `${fullNameId}-error` : undefined
          }
          required
        />
        {fieldErrors.fullName ? (
          <p className="field-error" id={`${fullNameId}-error`}>
            {fieldErrors.fullName}
          </p>
        ) : null}
      </div>

      <div className="field-group">
        <label htmlFor={emailId}>Email address</label>
        <input
          id={emailId}
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={values.email}
          onChange={(event) => updateField('email', event)}
          maxLength={254}
          disabled={submitting}
          aria-invalid={fieldErrors.email ? 'true' : undefined}
          aria-describedby={fieldErrors.email ? `${emailId}-error` : undefined}
          required
        />
        {fieldErrors.email ? (
          <p className="field-error" id={`${emailId}-error`}>
            {fieldErrors.email}
          </p>
        ) : null}
      </div>

      <div className="field-group">
        <label htmlFor={roleId}>Role applied for</label>
        <input
          id={roleId}
          name="roleAppliedFor"
          type="text"
          value={values.roleAppliedFor}
          onChange={(event) => updateField('roleAppliedFor', event)}
          maxLength={200}
          disabled={submitting}
          aria-invalid={fieldErrors.roleAppliedFor ? 'true' : undefined}
          aria-describedby={
            fieldErrors.roleAppliedFor ? `${roleId}-error` : undefined
          }
          required
        />
        {fieldErrors.roleAppliedFor ? (
          <p className="field-error" id={`${roleId}-error`}>
            {fieldErrors.roleAppliedFor}
          </p>
        ) : null}
      </div>

      <div className="candidate-form__actions">
        <Button type="submit" loading={submitting}>
          {submitting ? 'Creating candidate' : 'Create candidate'}
        </Button>
        <a className="button button--quiet" href="/candidates">
          Cancel
        </a>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
    </form>
  );
}

'use client';

import {
  confirmCvExtractionRequestSchema,
  cvExtractionSchema,
  type ConfirmCvExtractionRequest,
  type CvExtraction,
  type CvProfile,
} from '@candidate-compliance/contracts';
import Link from 'next/link';
import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import { FrontendRequestError, requestFrontend } from '../lib/frontend-api';
import { AlertBanner } from './alert-banner';
import { Button } from './button';

type ProfileField =
  'fullName' | 'skills' | 'yearsOfExperience' | 'certifications';
type ProfileFieldErrors = Partial<Record<ProfileField, string>>;

interface ProfileValues {
  fullName: string;
  skills: string;
  yearsOfExperience: string;
  certifications: string;
}

interface CvProposalReviewProps {
  candidateId: string;
  createAttemptId?: () => string;
  extraction: CvExtraction;
  onSessionLost?: () => void;
}

function defaultAttemptId(): string {
  return globalThis.crypto.randomUUID();
}

function defaultSessionLostTransition(): void {
  window.location.assign('/sign-in?reason=session');
}

function listText(values: string[]): string {
  return values.join('\n');
}

function listValues(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formValues(profile: CvProfile): ProfileValues {
  return {
    fullName: profile.fullName,
    skills: listText(profile.skills),
    yearsOfExperience: String(profile.yearsOfExperience),
    certifications: listText(profile.certifications),
  };
}

function profileInput(values: ProfileValues): ConfirmCvExtractionRequest {
  return {
    fullName: values.fullName,
    skills: listValues(values.skills),
    yearsOfExperience: Number(values.yearsOfExperience),
    certifications: listValues(values.certifications),
  };
}

function fieldErrorsFromIssues(
  issues: readonly { path: PropertyKey[]; message: string }[],
): ProfileFieldErrors {
  const errors: ProfileFieldErrors = {};

  for (const issue of issues) {
    const field = issue.path[0];

    if (
      field === 'fullName' ||
      field === 'skills' ||
      field === 'yearsOfExperience' ||
      field === 'certifications'
    ) {
      errors[field] ??= issue.message;
    }
  }

  return errors;
}

function ProfileReadOnly({ profile }: { profile: CvProfile }) {
  return (
    <dl className="cv-profile-readonly">
      <div>
        <dt>Name</dt>
        <dd>{profile.fullName}</dd>
      </div>
      <div>
        <dt>Skills</dt>
        <dd>
          {profile.skills.length ? profile.skills.join(', ') : 'None proposed'}
        </dd>
      </div>
      <div>
        <dt>Years of experience</dt>
        <dd>{profile.yearsOfExperience}</dd>
      </div>
      <div>
        <dt>Certifications</dt>
        <dd>
          {profile.certifications.length
            ? profile.certifications.join(', ')
            : 'None proposed'}
        </dd>
      </div>
    </dl>
  );
}

export function CvProposalReview({
  candidateId,
  createAttemptId = defaultAttemptId,
  extraction: initialExtraction,
  onSessionLost = defaultSessionLostTransition,
}: CvProposalReviewProps) {
  const fullNameId = useId();
  const skillsId = useId();
  const experienceId = useId();
  const certificationsId = useId();
  const [extraction, setExtraction] = useState(initialExtraction);
  const [values, setValues] = useState(() =>
    formValues(initialExtraction.proposedOutput),
  );
  const [confirmAttemptId] = useState(createAttemptId);
  const [rejectAttemptId] = useState(createAttemptId);
  const [pendingProfile, setPendingProfile] =
    useState<ConfirmCvExtractionRequest | null>(null);
  const [confirmation, setConfirmation] = useState<'confirm' | 'reject' | null>(
    null,
  );
  const [fieldErrors, setFieldErrors] = useState<ProfileFieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState('');
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const rejectButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  const actionInProgress = useRef(false);

  useEffect(() => {
    if (confirmation === 'confirm') {
      confirmButtonRef.current?.focus();
    } else if (confirmation === 'reject') {
      rejectButtonRef.current?.focus();
    } else if (returnFocusRef.current) {
      returnFocusRef.current.focus();
      returnFocusRef.current = null;
    }
  }, [confirmation]);

  function updateField(
    field: ProfileField,
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ): void {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setError(null);
    setConfirmation(null);
    setPendingProfile(null);
  }

  function reviewConfirmation(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;

    if (submitter instanceof HTMLButtonElement) {
      returnFocusRef.current = submitter;
    }

    const parsed = confirmCvExtractionRequestSchema.safeParse(
      profileInput(values),
    );

    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromIssues(parsed.error.issues));
      setError('Check the highlighted recruiter-confirmed values.');
      setStatus('Profile confirmation validation failed.');
      return;
    }

    setFieldErrors({});
    setError(null);
    setPendingProfile(parsed.data);
    setConfirmation('confirm');
  }

  function cancelConfirmation(): void {
    setConfirmation(null);
    setPendingProfile(null);
    setError(null);
  }

  function actionError(caught: unknown, action: 'confirm' | 'reject'): void {
    if (caught instanceof FrontendRequestError) {
      const serverFields = fieldErrorsFromIssues(
        (caught.problem.errors ?? []).map((item) => ({
          path: item.path.split('.'),
          message: item.message,
        })),
      );
      setFieldErrors(serverFields);
      setError(
        caught.problem.status === 403
          ? `You do not have permission to ${action} this proposal.`
          : caught.problem.status === 404
            ? 'This proposal is no longer available in the selected tenant.'
            : caught.problem.status === 409
              ? 'This proposal has already been decided. Reload to review its latest state.'
              : Object.keys(serverFields).length
                ? 'Check the highlighted recruiter-confirmed values.'
                : `The proposal could not be ${action === 'confirm' ? 'confirmed' : 'rejected'}. Please try again.`,
      );
      return;
    }

    setError(
      `The proposal could not be ${action === 'confirm' ? 'confirmed' : 'rejected'}. Please try again.`,
    );
  }

  async function confirmProposal(): Promise<void> {
    if (actionInProgress.current || !pendingProfile) {
      return;
    }

    actionInProgress.current = true;
    setSubmitting(true);
    setError(null);
    setStatus('Confirming recruiter-reviewed profile values.');

    try {
      const accepted = await requestFrontend(
        `/api/cv-extractions/${extraction.id}/confirm`,
        cvExtractionSchema,
        {
          method: 'POST',
          body: JSON.stringify({
            attemptId: confirmAttemptId,
            profile: pendingProfile,
          }),
        },
      );
      setExtraction(accepted);
      setConfirmation(null);
      setPendingProfile(null);
      setStatus('Recruiter-confirmed profile accepted as authoritative.');
    } catch (caught) {
      if (
        caught instanceof FrontendRequestError &&
        caught.problem.status === 401
      ) {
        setStatus('Your session has expired.');
        onSessionLost();
        return;
      }
      actionError(caught, 'confirm');
      setStatus('Profile confirmation failed. Your edits were kept.');
    } finally {
      actionInProgress.current = false;
      setSubmitting(false);
    }
  }

  async function rejectProposal(): Promise<void> {
    if (actionInProgress.current) {
      return;
    }

    actionInProgress.current = true;
    setSubmitting(true);
    setError(null);
    setStatus('Rejecting the AI proposal only.');

    try {
      const rejected = await requestFrontend(
        `/api/cv-extractions/${extraction.id}/reject`,
        cvExtractionSchema,
        {
          method: 'POST',
          body: JSON.stringify({ attemptId: rejectAttemptId }),
        },
      );
      setExtraction(rejected);
      setConfirmation(null);
      setStatus('AI proposal rejected. The Candidate record was not rejected.');
    } catch (caught) {
      if (
        caught instanceof FrontendRequestError &&
        caught.problem.status === 401
      ) {
        setStatus('Your session has expired.');
        onSessionLost();
        return;
      }
      actionError(caught, 'reject');
      setStatus('Proposal rejection failed. The Candidate was not changed.');
    } finally {
      actionInProgress.current = false;
      setSubmitting(false);
    }
  }

  const proposed = extraction.proposedOutput;
  const accepted = extraction.status === 'ACCEPTED';
  const rejected = extraction.status === 'REJECTED';

  return (
    <article className="cv-review-page">
      <Link className="back-link" href={`/candidates/${candidateId}`}>
        Back to candidate
      </Link>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Governed CV extraction</p>
          <h1>Review CV proposal</h1>
          <p>
            AI output remains advisory until a recruiter explicitly confirms
            validated profile values.
          </p>
        </div>
        <span
          className={`cv-status cv-status--${extraction.status.toLowerCase()}`}
        >
          {accepted ? 'Confirmed (ACCEPTED)' : extraction.status}
        </span>
      </div>

      {accepted && extraction.confirmedOutput ? (
        <AlertBanner title="Recruiter-confirmed profile" tone="success">
          <p>
            These values are authoritative. The original AI proposal remains
            separately visible as retained evidence.
          </p>
        </AlertBanner>
      ) : rejected ? (
        <AlertBanner title="AI proposal rejected" tone="information">
          <p>
            Only this advisory proposal was rejected. The Candidate record was
            not rejected, scored, ranked or removed.
          </p>
        </AlertBanner>
      ) : (
        <AlertBanner title="Proposal is not authoritative" tone="information">
          <p>
            Review every proposed value. Edit the recruiter-confirmed column
            before choosing whether to confirm or reject this proposal.
          </p>
        </AlertBanner>
      )}

      <section className="cv-proposal" aria-labelledby="proposal-title">
        <div className="section-heading">
          <div>
            <p className="section-label">Retained advisory evidence</p>
            <h2 id="proposal-title">AI-proposed values</h2>
          </div>
        </div>
        <ProfileReadOnly profile={proposed} />
      </section>

      {accepted && extraction.confirmedOutput ? (
        <section className="cv-confirmed" aria-labelledby="confirmed-title">
          <div className="section-heading">
            <div>
              <p className="section-label">Authoritative profile</p>
              <h2 id="confirmed-title">Recruiter-confirmed values</h2>
            </div>
          </div>
          <ProfileReadOnly profile={extraction.confirmedOutput} />
        </section>
      ) : null}

      {extraction.status === 'PROPOSED' ? (
        <form
          className="cv-confirmation-form"
          onSubmit={reviewConfirmation}
          noValidate
        >
          <div className="section-heading">
            <div>
              <p className="section-label">Human decision</p>
              <h2>Recruiter-confirmed values</h2>
            </div>
          </div>
          {error ? (
            <AlertBanner title="Unable to decide proposal" tone="error">
              <p>{error}</p>
            </AlertBanner>
          ) : null}
          <div className="cv-comparison-grid">
            <div className="field-group">
              <label htmlFor={fullNameId}>Confirmed name</label>
              <input
                id={fullNameId}
                value={values.fullName}
                onChange={(event) => updateField('fullName', event)}
                disabled={submitting}
                aria-invalid={fieldErrors.fullName ? 'true' : undefined}
                aria-describedby={
                  fieldErrors.fullName ? `${fullNameId}-error` : undefined
                }
              />
              {fieldErrors.fullName ? (
                <p className="field-error" id={`${fullNameId}-error`}>
                  {fieldErrors.fullName}
                </p>
              ) : null}
            </div>
            <div className="field-group">
              <label htmlFor={experienceId}>
                Confirmed years of experience
              </label>
              <input
                id={experienceId}
                type="number"
                min="0"
                max="80"
                step="1"
                value={values.yearsOfExperience}
                onChange={(event) => updateField('yearsOfExperience', event)}
                disabled={submitting}
                aria-invalid={
                  fieldErrors.yearsOfExperience ? 'true' : undefined
                }
                aria-describedby={
                  fieldErrors.yearsOfExperience
                    ? `${experienceId}-error`
                    : undefined
                }
              />
              {fieldErrors.yearsOfExperience ? (
                <p className="field-error" id={`${experienceId}-error`}>
                  {fieldErrors.yearsOfExperience}
                </p>
              ) : null}
            </div>
            <div className="field-group">
              <label htmlFor={skillsId}>Confirmed skills</label>
              <textarea
                id={skillsId}
                rows={5}
                value={values.skills}
                onChange={(event) => updateField('skills', event)}
                disabled={submitting}
                aria-invalid={fieldErrors.skills ? 'true' : undefined}
                aria-describedby={`${skillsId}-hint${fieldErrors.skills ? ` ${skillsId}-error` : ''}`}
              />
              <p className="field-hint" id={`${skillsId}-hint`}>
                Enter one skill per line.
              </p>
              {fieldErrors.skills ? (
                <p className="field-error" id={`${skillsId}-error`}>
                  {fieldErrors.skills}
                </p>
              ) : null}
            </div>
            <div className="field-group">
              <label htmlFor={certificationsId}>Confirmed certifications</label>
              <textarea
                id={certificationsId}
                rows={5}
                value={values.certifications}
                onChange={(event) => updateField('certifications', event)}
                disabled={submitting}
                aria-invalid={fieldErrors.certifications ? 'true' : undefined}
                aria-describedby={`${certificationsId}-hint${fieldErrors.certifications ? ` ${certificationsId}-error` : ''}`}
              />
              <p className="field-hint" id={`${certificationsId}-hint`}>
                Enter one certification per line. Leave empty when none are
                confirmed.
              </p>
              {fieldErrors.certifications ? (
                <p className="field-error" id={`${certificationsId}-error`}>
                  {fieldErrors.certifications}
                </p>
              ) : null}
            </div>
          </div>
          <div className="cv-decision-actions">
            <Button type="submit" loading={submitting}>
              Review confirmation
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={submitting}
              onClick={(event) => {
                returnFocusRef.current = event.currentTarget;
                setPendingProfile(null);
                setConfirmation('reject');
                setError(null);
              }}
            >
              Reject AI proposal
            </Button>
          </div>

          {confirmation === 'confirm' ? (
            <div
              className="decision-confirmation"
              role="group"
              aria-labelledby="confirm-profile-title"
              onKeyDown={(event) => {
                if (event.key === 'Escape' && !submitting) {
                  cancelConfirmation();
                }
              }}
            >
              <h3 id="confirm-profile-title">
                Confirm this recruiter profile?
              </h3>
              <p>
                These reviewed values will become authoritative while the AI
                proposal remains retained separately.
              </p>
              <div className="button-row">
                <Button
                  ref={confirmButtonRef}
                  type="button"
                  loading={submitting}
                  onClick={confirmProposal}
                >
                  Confirm profile
                </Button>
                <Button
                  type="button"
                  variant="quiet"
                  disabled={submitting}
                  onClick={cancelConfirmation}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          {confirmation === 'reject' ? (
            <div
              className="decision-confirmation"
              role="group"
              aria-labelledby="reject-proposal-title"
              onKeyDown={(event) => {
                if (event.key === 'Escape' && !submitting) {
                  cancelConfirmation();
                }
              }}
            >
              <h3 id="reject-proposal-title">Reject this AI proposal only?</h3>
              <p>
                This does not reject, score, rank, remove or otherwise change
                the Candidate record.
              </p>
              <div className="button-row">
                <Button
                  ref={rejectButtonRef}
                  type="button"
                  variant="secondary"
                  loading={submitting}
                  onClick={rejectProposal}
                >
                  Reject proposal only
                </Button>
                <Button
                  type="button"
                  variant="quiet"
                  disabled={submitting}
                  onClick={cancelConfirmation}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
          <p className="sr-only" role="status" aria-live="polite">
            {status}
          </p>
        </form>
      ) : null}
    </article>
  );
}

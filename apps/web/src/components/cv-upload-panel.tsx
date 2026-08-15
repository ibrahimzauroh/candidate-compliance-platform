'use client';

import {
  cvExtractionSchema,
  type CvExtraction,
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

const CV_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
const supportedMediaTypes = new Set(['application/pdf', 'text/plain']);

interface CvUploadPanelProps {
  candidateId: string;
  createAttemptId?: () => string;
  onCreated?: (extraction: CvExtraction) => void;
  onSessionLost?: () => void;
}

function defaultAttemptId(): string {
  return globalThis.crypto.randomUUID();
}

function defaultSessionLostTransition(): void {
  window.location.assign('/sign-in?reason=session');
}

export function CvUploadPanel({
  candidateId,
  createAttemptId = defaultAttemptId,
  onCreated,
  onSessionLost = defaultSessionLostTransition,
}: CvUploadPanelProps) {
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [attemptId, setAttemptId] = useState(createAttemptId);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState('');
  const submissionInProgress = useRef(false);

  function selectFile(event: ChangeEvent<HTMLInputElement>): void {
    setFile(event.target.files?.[0] ?? null);
    setAttemptId(createAttemptId());
    setError(null);
    setStatus('');
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (submissionInProgress.current) {
      return;
    }

    if (!file) {
      setError('Choose a UTF-8 text or PDF CV to continue.');
      setStatus('CV upload validation failed.');
      return;
    }

    if (!supportedMediaTypes.has(file.type)) {
      setError('Only UTF-8 text and PDF files are supported.');
      setStatus('CV upload validation failed.');
      return;
    }

    if (file.size === 0 || file.size > CV_UPLOAD_MAX_BYTES) {
      setError('The CV must be non-empty and no larger than 2 MiB.');
      setStatus('CV upload validation failed.');
      return;
    }

    submissionInProgress.current = true;
    setSubmitting(true);
    setError(null);
    setStatus('Extracting a non-authoritative CV proposal.');

    try {
      const extraction = await requestFrontend(
        `/api/candidates/${candidateId}/cv-extractions`,
        cvExtractionSchema,
        {
          method: 'POST',
          headers: {
            'Content-Type': file.type,
            'X-CV-Attempt-Id': attemptId,
          },
          body: file,
        },
      );
      setStatus('Proposal created. Opening recruiter review.');

      if (onCreated) {
        onCreated(extraction);
      } else {
        window.location.assign(
          `/candidates/${candidateId}/cv-extractions/${extraction.id}`,
        );
      }
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
          ? 'You do not have permission to extract CV proposals in this tenant.'
          : caught instanceof FrontendRequestError &&
              caught.problem.status === 404
            ? 'This candidate is no longer available in the selected tenant.'
            : caught instanceof FrontendRequestError &&
                caught.problem.status === 400
              ? 'The CV could not be processed. Check its format and content.'
              : 'The CV proposal could not be created. Please try again.',
      );
      setStatus('CV extraction failed. The selected file was kept for retry.');
    } finally {
      submissionInProgress.current = false;
      setSubmitting(false);
    }
  }

  return (
    <section className="cv-upload-panel" aria-labelledby="cv-upload-title">
      <div className="section-heading">
        <div>
          <p className="section-label">Governed AI assistance</p>
          <h2 id="cv-upload-title">Review a CV proposal</h2>
        </div>
      </div>
      <p>
        Upload a UTF-8 text or PDF CV. Extraction produces an advisory proposal
        only; a recruiter must review and explicitly confirm it.
      </p>
      <form className="cv-upload-form" onSubmit={submit} noValidate>
        {error ? (
          <AlertBanner title="Unable to extract CV" tone="error">
            <p>{error}</p>
          </AlertBanner>
        ) : null}
        <div className="field-group">
          <label htmlFor={inputId}>CV file</label>
          <input
            id={inputId}
            name="cv"
            type="file"
            accept=".txt,.pdf,text/plain,application/pdf"
            onChange={selectFile}
            disabled={submitting}
            aria-describedby={`${inputId}-hint${error ? ` ${inputId}-error` : ''}`}
            aria-invalid={error ? 'true' : undefined}
          />
          <p className="field-hint" id={`${inputId}-hint`}>
            UTF-8 text or PDF, maximum 2 MiB. Raw content is processed in memory
            and is not retained by the API.
          </p>
          {error ? (
            <p className="field-error" id={`${inputId}-error`}>
              {error}
            </p>
          ) : null}
        </div>
        <Button type="submit" loading={submitting}>
          {submitting ? 'Extracting proposal' : 'Upload and review proposal'}
        </Button>
        <p className="sr-only" role="status" aria-live="polite">
          {status}
        </p>
      </form>
    </section>
  );
}

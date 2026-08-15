'use client';

import {
  loginRequestSchema,
  userIdentitySchema,
} from '@candidate-compliance/contracts';
import { type FormEvent, useEffect, useId, useState } from 'react';

import {
  FrontendRequestError,
  requestFrontend,
  requestFrontendNoContent,
} from '../lib/frontend-api';
import { AlertBanner } from './alert-banner';
import { Button } from './button';

interface SignInFormProps {
  initialMessage?: string;
  onAuthenticated?: () => void;
}

interface FieldErrors {
  email?: string;
  password?: string;
}

function defaultAuthenticatedTransition(): void {
  window.location.assign('/select-tenant');
}

export function SignInForm({
  initialMessage,
  onAuthenticated = defaultAuthenticatedTransition,
}: SignInFormProps) {
  const emailId = useId();
  const passwordId = useId();
  const errorSummaryId = useId();
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState(initialMessage ?? '');

  useEffect(() => {
    let active = true;

    requestFrontendNoContent('/api/session/logout', { method: 'POST' })
      .catch(() => undefined)
      .finally(() => {
        if (active) {
          setReady(true);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (submitting || !ready) {
      return;
    }

    const form = new FormData(event.currentTarget);
    const input = loginRequestSchema.safeParse({
      email: form.get('email'),
      password: form.get('password'),
    });

    if (!input.success) {
      const nextErrors: FieldErrors = {};

      for (const issue of input.error.issues) {
        const field = issue.path[0];
        if (field === 'email' || field === 'password') {
          nextErrors[field] ??= issue.message;
        }
      }

      setFieldErrors(nextErrors);
      setFormError('Check the highlighted fields and try again.');
      setStatus('Sign-in form validation failed.');
      return;
    }

    setFieldErrors({});
    setFormError(null);
    setSubmitting(true);
    setStatus('Signing in.');

    try {
      await requestFrontend('/api/session/login', userIdentitySchema, {
        method: 'POST',
        body: JSON.stringify(input.data),
      });
      setStatus('Signed in. Loading your tenant memberships.');
      onAuthenticated();
    } catch (error) {
      const message =
        error instanceof FrontendRequestError && error.problem.status === 401
          ? 'Email or password was not recognised.'
          : 'Sign in is unavailable right now. Please try again.';
      setFormError(message);
      setStatus('Sign in failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      {initialMessage ? <AlertBanner>{initialMessage}</AlertBanner> : null}
      {formError ? (
        <AlertBanner title="Unable to sign in" tone="error">
          <p id={errorSummaryId}>{formError}</p>
        </AlertBanner>
      ) : null}

      <div className="field-group">
        <label htmlFor={emailId}>Email address</label>
        <input
          id={emailId}
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          aria-invalid={fieldErrors.email ? 'true' : undefined}
          aria-describedby={fieldErrors.email ? `${emailId}-error` : undefined}
          disabled={submitting || !ready}
          required
        />
        {fieldErrors.email ? (
          <p className="field-error" id={`${emailId}-error`}>
            {fieldErrors.email}
          </p>
        ) : null}
      </div>

      <div className="field-group">
        <label htmlFor={passwordId}>Password</label>
        <input
          id={passwordId}
          name="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={fieldErrors.password ? 'true' : undefined}
          aria-describedby={
            fieldErrors.password ? `${passwordId}-error` : undefined
          }
          disabled={submitting || !ready}
          required
        />
        {fieldErrors.password ? (
          <p className="field-error" id={`${passwordId}-error`}>
            {fieldErrors.password}
          </p>
        ) : null}
      </div>

      <Button type="submit" loading={submitting} disabled={!ready}>
        {ready ? 'Sign in securely' : 'Preparing sign in'}
      </Button>

      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
    </form>
  );
}

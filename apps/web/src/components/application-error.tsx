'use client';

import { AlertBanner } from './alert-banner';
import { Button } from './button';

interface ApplicationErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export function ApplicationError({ error, reset }: ApplicationErrorProps) {
  void error;

  return (
    <main className="centered-page">
      <section className="compact-card">
        <p className="eyebrow">Candidate Compliance</p>
        <h1>Workspace unavailable</h1>
        <AlertBanner title="The request could not be completed" tone="error">
          <p>
            No sensitive diagnostic information is shown here. Try the request
            again, or return to sign in if your session has expired.
          </p>
        </AlertBanner>
        <div className="button-row">
          <Button type="button" onClick={reset}>
            Try again
          </Button>
          <a className="button button--secondary" href="/sign-in">
            Return to sign in
          </a>
        </div>
      </section>
    </main>
  );
}

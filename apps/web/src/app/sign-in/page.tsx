import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { SignInForm } from '../../components/sign-in-form';
import { ApiRequestError } from '../../lib/server-api';
import { authenticatedUser } from '../../lib/session';

export const metadata: Metadata = { title: 'Sign in' };

interface SignInPageProps {
  searchParams: Promise<{ reason?: string | string[] }>;
}

function reasonMessage(
  reason: string | string[] | undefined,
): string | undefined {
  if (reason === 'signed-out') {
    return 'You have signed out. Your tenant selection has been cleared.';
  }

  if (reason === 'session') {
    return 'Your session ended. Sign in again to continue.';
  }

  return undefined;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  try {
    if (await authenticatedUser()) {
      redirect('/');
    }
  } catch (error) {
    if (!(error instanceof ApiRequestError)) {
      throw error;
    }
  }

  const { reason } = await searchParams;

  return (
    <main className="auth-page" id="main-content">
      <section className="auth-introduction" aria-labelledby="sign-in-title">
        <div>
          <p className="eyebrow">Secure operations workspace</p>
          <h1 id="sign-in-title">Candidate compliance platform</h1>
          <p className="auth-introduction__lead">
            Sign in first. Tenant access is discovered from your authenticated
            account before any workspace is selected.
          </p>
        </div>
        <ul className="trust-list" aria-label="Security boundaries">
          <li>Identity and tenant selection remain separate</li>
          <li>Every tenant choice is validated by the API</li>
          <li>Sessions stay out of browser storage</li>
        </ul>
      </section>

      <section className="auth-card" aria-label="Sign in form">
        <div className="auth-card__heading">
          <span className="brand__mark" aria-hidden="true">
            CC
          </span>
          <div>
            <p className="section-label">Candidate Compliance</p>
            <h2>Sign in to continue</h2>
          </div>
        </div>
        <SignInForm initialMessage={reasonMessage(reason)} />
      </section>
    </main>
  );
}

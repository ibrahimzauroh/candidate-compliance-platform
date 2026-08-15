import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { TenantSelector } from '../../components/tenant-selector';
import { SignOutButton } from '../../components/session-actions';
import { ApiRequestError } from '../../lib/server-api';
import { authenticatedUser } from '../../lib/session';

export const metadata: Metadata = { title: 'Select tenant' };

export default async function SelectTenantPage() {
  let user;

  try {
    user = await authenticatedUser();
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) {
      redirect('/sign-in?reason=session');
    }

    throw error;
  }

  if (!user) {
    redirect('/sign-in?reason=session');
  }

  return (
    <main className="centered-page" id="main-content">
      <section className="selection-card" aria-labelledby="tenant-title">
        <div className="selection-card__header">
          <p className="eyebrow">Authenticated as {user.email}</p>
          <h1 id="tenant-title">Choose your tenant context</h1>
          <p>
            Select only from the current memberships assigned to your account.
            The API validates your choice before the workspace opens.
          </p>
        </div>
        <TenantSelector />
        <div className="selection-card__sign-out">
          <span>Not {user.displayName}?</span>
          <SignOutButton />
        </div>
      </section>
    </main>
  );
}

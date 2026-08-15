import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { AppShell } from '../../components/app-shell';
import { ApiRequestError } from '../../lib/server-api';
import { readyTenantSession, sessionToken } from '../../lib/session';

export default async function AuthenticatedLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  let session;

  try {
    session = await readyTenantSession();
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) {
      redirect('/sign-in?reason=session');
    }

    if (error instanceof ApiRequestError && error.status === 403) {
      redirect('/select-tenant');
    }

    throw error;
  }

  if (!session) {
    redirect((await sessionToken()) ? '/select-tenant' : '/sign-in');
  }

  return (
    <AppShell
      user={session.user}
      memberships={session.memberships}
      currentMembership={session.membership}
    >
      {children}
    </AppShell>
  );
}

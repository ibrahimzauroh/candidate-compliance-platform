import type {
  MembershipOption,
  UserIdentity,
} from '@candidate-compliance/contracts';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { roleLabel } from '../lib/selection';
import { PrimaryNavigation } from './primary-navigation';
import { SignOutButton, TenantSwitcher } from './session-actions';

interface AppShellProps {
  children: ReactNode;
  user: UserIdentity;
  memberships: MembershipOption[];
  currentMembership: MembershipOption;
}

export function AppShell({
  children,
  user,
  memberships,
  currentMembership,
}: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__inner">
          <Link
            href="/"
            className="brand"
            aria-label="Candidate Compliance home"
          >
            <span className="brand__mark" aria-hidden="true">
              CC
            </span>
            <span>
              <span className="brand__name">Candidate Compliance</span>
              <span className="brand__descriptor">Operations workspace</span>
            </span>
          </Link>

          <PrimaryNavigation />

          <div className="session-panel">
            <TenantSwitcher
              memberships={memberships}
              selectedTenantId={currentMembership.tenantId}
            />
            <div className="identity-card">
              <span className="identity-card__name">{user.displayName}</span>
              <span className="role-badge">
                {roleLabel(currentMembership.role)}
              </span>
              <span className="identity-card__email">{user.email}</span>
            </div>
            <SignOutButton />
          </div>
        </div>
        <div className="global-status" aria-live="polite" aria-atomic="true" />
      </header>

      <main className="app-main" id="main-content">
        {children}
      </main>
    </div>
  );
}

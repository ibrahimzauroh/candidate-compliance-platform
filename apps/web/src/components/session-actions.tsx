'use client';

import {
  tenantContextSchema,
  type MembershipOption,
} from '@candidate-compliance/contracts';
import { useId, useState } from 'react';

import { requestFrontend, requestFrontendNoContent } from '../lib/frontend-api';
import { roleLabel } from '../lib/selection';
import { Button } from './button';

interface TenantSwitcherProps {
  memberships: MembershipOption[];
  selectedTenantId: string;
}

export function TenantSwitcher({
  memberships,
  selectedTenantId,
}: TenantSwitcherProps) {
  const id = useId();
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState('');

  async function switchTenant(tenantId: string): Promise<void> {
    if (
      switching ||
      tenantId === selectedTenantId ||
      !memberships.some((membership) => membership.tenantId === tenantId)
    ) {
      return;
    }

    setSwitching(true);
    setError('');

    try {
      await requestFrontend('/api/session/tenant', tenantContextSchema, {
        method: 'POST',
        body: JSON.stringify({ tenantId }),
      });
      window.location.assign('/');
    } catch {
      setError('Tenant switching failed. Your current workspace is unchanged.');
      setSwitching(false);
    }
  }

  return (
    <div className="tenant-switcher">
      <label htmlFor={id}>Current tenant</label>
      <select
        id={id}
        value={selectedTenantId}
        onChange={(event) => void switchTenant(event.target.value)}
        disabled={switching}
        aria-describedby={error ? `${id}-error` : undefined}
      >
        {memberships.map((membership) => (
          <option key={membership.membershipId} value={membership.tenantId}>
            {membership.tenantName} — {roleLabel(membership.role)}
          </option>
        ))}
      </select>
      <span className="sr-only" role="status" aria-live="polite">
        {switching ? 'Validating the selected tenant.' : ''}
      </span>
      {error ? (
        <p className="tenant-switcher__error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function SignOutButton() {
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState('');

  async function signOut(): Promise<void> {
    if (signingOut) {
      return;
    }

    setSigningOut(true);
    setError('');

    try {
      await requestFrontendNoContent('/api/session/logout', { method: 'POST' });
      window.location.assign('/sign-in?reason=signed-out');
    } catch {
      setError('Sign out could not be completed. Please try again.');
      setSigningOut(false);
    }
  }

  return (
    <div className="sign-out-control">
      <Button
        type="button"
        variant="quiet"
        loading={signingOut}
        onClick={() => void signOut()}
      >
        Sign out
      </Button>
      {error ? (
        <p className="sign-out-control__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

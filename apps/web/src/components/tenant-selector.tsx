'use client';

import {
  membershipListResponseSchema,
  tenantContextSchema,
  type MembershipOption,
} from '@candidate-compliance/contracts';
import { type FormEvent, useEffect, useId, useState } from 'react';

import { FrontendRequestError, requestFrontend } from '../lib/frontend-api';
import { roleLabel } from '../lib/selection';
import { AlertBanner } from './alert-banner';
import { Button } from './button';

interface TenantSelectorProps {
  onSelected?: () => void;
  onSessionLost?: () => void;
}

type DiscoveryState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; memberships: MembershipOption[] };

function goToApplication(): void {
  window.location.assign('/');
}

function goToSignIn(): void {
  window.location.assign('/sign-in?reason=session');
}

export function TenantSelector({
  onSelected = goToApplication,
  onSessionLost = goToSignIn,
}: TenantSelectorProps) {
  const selectId = useId();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<DiscoveryState>({ kind: 'loading' });
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [switching, setSwitching] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    requestFrontend('/api/session/memberships', membershipListResponseSchema, {
      signal: controller.signal,
    })
      .then(({ memberships }) => {
        setState({ kind: 'ready', memberships });
        setSelectedTenantId(
          memberships.length === 1 ? memberships[0]!.tenantId : '',
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        if (
          error instanceof FrontendRequestError &&
          error.problem.status === 401
        ) {
          onSessionLost();
          return;
        }

        setState({
          kind: 'error',
          message:
            'Your tenant memberships could not be loaded. Please try again.',
        });
      });

    return () => controller.abort();
  }, [attempt, onSessionLost]);

  async function selectTenant(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();

    if (
      state.kind !== 'ready' ||
      switching ||
      !state.memberships.some(
        (membership) => membership.tenantId === selectedTenantId,
      )
    ) {
      setSelectionError('Choose one of your available tenants to continue.');
      return;
    }

    setSwitching(true);
    setSelectionError(null);

    try {
      await requestFrontend('/api/session/tenant', tenantContextSchema, {
        method: 'POST',
        body: JSON.stringify({ tenantId: selectedTenantId }),
      });
      onSelected();
    } catch (error) {
      if (
        error instanceof FrontendRequestError &&
        error.problem.status === 401
      ) {
        onSessionLost();
        return;
      }

      setSelectionError(
        error instanceof FrontendRequestError && error.problem.status === 403
          ? 'That tenant is no longer available for this account. Reload your memberships and choose again.'
          : 'The tenant could not be selected. Please try again.',
      );
      setSwitching(false);
    }
  }

  if (state.kind === 'loading') {
    return (
      <div className="state-card" role="status" aria-live="polite">
        <span className="state-card__spinner" aria-hidden="true" />
        <div>
          <h2>Loading tenant access</h2>
          <p>Checking the memberships assigned to your account.</p>
        </div>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <AlertBanner title="Memberships unavailable" tone="error">
        <p>{state.message}</p>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setState({ kind: 'loading' });
            setAttempt((value) => value + 1);
          }}
        >
          Try again
        </Button>
      </AlertBanner>
    );
  }

  if (state.memberships.length === 0) {
    return (
      <div className="state-card" role="status">
        <div className="state-card__mark" aria-hidden="true">
          0
        </div>
        <div>
          <h2>No tenant access</h2>
          <p>
            Your account is authenticated but has no current tenant memberships.
            Ask an administrator to review your access.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form className="tenant-form" onSubmit={selectTenant}>
      <div className="field-group">
        <label htmlFor={selectId}>Tenant</label>
        <select
          id={selectId}
          value={selectedTenantId}
          onChange={(event) => {
            setSelectedTenantId(event.target.value);
            setSelectionError(null);
          }}
          disabled={switching}
          aria-invalid={selectionError ? 'true' : undefined}
          aria-describedby={selectionError ? `${selectId}-error` : undefined}
          required
        >
          {state.memberships.length > 1 ? (
            <option value="">Choose a tenant</option>
          ) : null}
          {state.memberships.map((membership) => (
            <option key={membership.membershipId} value={membership.tenantId}>
              {membership.tenantName} — {roleLabel(membership.role)}
            </option>
          ))}
        </select>
        <p className="field-hint">
          Only memberships returned for your authenticated account are shown.
        </p>
        {selectionError ? (
          <p className="field-error" id={`${selectId}-error`} role="alert">
            {selectionError}
          </p>
        ) : null}
      </div>

      <Button type="submit" loading={switching}>
        {switching ? 'Validating tenant' : 'Continue to workspace'}
      </Button>
    </form>
  );
}

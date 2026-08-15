import {
  membershipListResponseSchema,
  tenantContextSchema,
  userIdentitySchema,
  type MembershipListResponse,
  type MembershipOption,
  type TenantContext,
  type UserIdentity,
} from '@candidate-compliance/contracts';
import { cookies } from 'next/headers';
import { cache } from 'react';

import { ApiRequestError, requestApi } from './server-api';
import { resolveMembershipSelection } from './selection';
import { SESSION_COOKIE_NAME, TENANT_COOKIE_NAME } from './session-cookies';

export interface ReadyTenantSession {
  user: UserIdentity;
  memberships: MembershipOption[];
  membership: MembershipOption;
  tenantContext: TenantContext;
}

export async function sessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE_NAME)?.value;
}

export async function authenticatedUser(): Promise<UserIdentity | null> {
  const token = await sessionToken();

  if (!token) {
    return null;
  }

  return requestApi({
    path: '/api/v1/auth/me',
    schema: userIdentitySchema,
    token,
  });
}

export async function authenticatedMemberships(
  token: string,
): Promise<MembershipListResponse> {
  return requestApi({
    path: '/api/v1/memberships',
    schema: membershipListResponseSchema,
    token,
  });
}

export async function validateTenantSession(
  token: string,
  selectedTenantId: string | undefined,
): Promise<ReadyTenantSession | null> {
  if (!selectedTenantId) {
    return null;
  }

  const [user, membershipResponse] = await Promise.all([
    requestApi({
      path: '/api/v1/auth/me',
      schema: userIdentitySchema,
      token,
    }),
    authenticatedMemberships(token),
  ]);
  const selection = resolveMembershipSelection(
    membershipResponse.memberships,
    selectedTenantId,
  );

  if (!selection.membership) {
    return null;
  }

  const tenantContext = await requestApi({
    path: '/api/v1/context',
    schema: tenantContextSchema,
    token,
    tenantId: selection.membership.tenantId,
  });

  if (
    tenantContext.userId !== user.id ||
    tenantContext.membershipId !== selection.membership.membershipId ||
    tenantContext.tenantId !== selection.membership.tenantId ||
    tenantContext.role !== selection.membership.role
  ) {
    throw new ApiRequestError(403, {
      type: 'about:blank',
      title: 'Forbidden',
      status: 403,
      detail: 'The selected tenant context is no longer available.',
    });
  }

  return {
    user,
    memberships: membershipResponse.memberships,
    membership: selection.membership,
    tenantContext,
  };
}

export const readyTenantSession = cache(
  async function readyTenantSession(): Promise<ReadyTenantSession | null> {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

    if (!token) {
      return null;
    }

    return validateTenantSession(
      token,
      cookieStore.get(TENANT_COOKIE_NAME)?.value,
    );
  },
);

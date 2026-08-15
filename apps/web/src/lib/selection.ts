import type { MembershipOption } from '@candidate-compliance/contracts';

export interface MembershipSelection {
  membership: MembershipOption | null;
  isStale: boolean;
}

export function resolveMembershipSelection(
  memberships: readonly MembershipOption[],
  selectedTenantId: string | undefined,
): MembershipSelection {
  if (!selectedTenantId) {
    return { membership: null, isStale: false };
  }

  const membership =
    memberships.find((option) => option.tenantId === selectedTenantId) ?? null;

  return { membership, isStale: membership === null };
}

export function roleLabel(role: MembershipOption['role']): string {
  return role
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

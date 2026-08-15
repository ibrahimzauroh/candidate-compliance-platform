import type { MembershipOption } from '@candidate-compliance/contracts';
import { describe, expect, it } from 'vitest';

import { resolveMembershipSelection, roleLabel } from './selection';

const memberships: MembershipOption[] = [
  {
    membershipId: '30000000-0000-4000-8000-000000000001',
    tenantId: '10000000-0000-4000-8000-000000000001',
    tenantName: 'Alpha Staffing',
    role: 'ADMIN',
  },
  {
    membershipId: '30000000-0000-4000-8000-000000000002',
    tenantId: '10000000-0000-4000-8000-000000000002',
    tenantName: 'Beta Staffing',
    role: 'COMPLIANCE_OFFICER',
  },
];

describe('resolveMembershipSelection', () => {
  it('does not invent a default selection before validation', () => {
    expect(resolveMembershipSelection(memberships, undefined)).toEqual({
      membership: null,
      isStale: false,
    });
  });

  it('resolves only an exact current membership tenant ID', () => {
    expect(
      resolveMembershipSelection(memberships, memberships[1]!.tenantId),
    ).toEqual({ membership: memberships[1], isStale: false });
  });

  it('rejects a stale or caller-invented tenant selection', () => {
    expect(
      resolveMembershipSelection(
        memberships,
        'ffffffff-ffff-4fff-8fff-ffffffffffff',
      ),
    ).toEqual({ membership: null, isStale: true });
  });
});

describe('roleLabel', () => {
  it('renders role meaning as text rather than colour alone', () => {
    expect(roleLabel('COMPLIANCE_OFFICER')).toBe('Compliance Officer');
  });
});

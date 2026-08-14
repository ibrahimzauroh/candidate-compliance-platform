import type { TenantContext } from '@candidate-compliance/contracts';
import { TenantRole } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { ALL_PERMISSIONS, hasPermission, PERMISSIONS } from './permissions.js';

function grantedPermissions(role: TenantRole) {
  const tenantContext: Pick<TenantContext, 'role'> = { role };

  return ALL_PERMISSIONS.filter((permission) =>
    hasPermission(tenantContext, permission),
  );
}

describe('role permission policy', () => {
  it('grants ADMIN every currently defined permission through the policy', () => {
    expect(grantedPermissions(TenantRole.ADMIN)).toEqual(ALL_PERMISSIONS);
  });

  it('grants RECRUITER exactly the recruiter permissions', () => {
    expect(grantedPermissions(TenantRole.RECRUITER)).toEqual([
      PERMISSIONS.candidateCreate,
      PERMISSIONS.candidateRead,
      PERMISSIONS.candidateUpdate,
      PERMISSIONS.documentCreate,
      PERMISSIONS.documentRead,
      PERMISSIONS.verificationRequest,
      PERMISSIONS.verificationRead,
      PERMISSIONS.aiExtract,
      PERMISSIONS.aiConfirm,
    ]);
  });

  it('grants COMPLIANCE_OFFICER exactly the compliance permissions', () => {
    expect(grantedPermissions(TenantRole.COMPLIANCE_OFFICER)).toEqual([
      PERMISSIONS.candidateRead,
      PERMISSIONS.documentCreate,
      PERMISSIONS.documentRead,
      PERMISSIONS.documentApprove,
      PERMISSIONS.documentCorrect,
      PERMISSIONS.verificationRequest,
      PERMISSIONS.verificationRead,
      PERMISSIONS.auditRead,
    ]);
  });

  it('grants VIEWER exactly the read-only viewer permissions', () => {
    expect(grantedPermissions(TenantRole.VIEWER)).toEqual([
      PERMISSIONS.candidateRead,
      PERMISSIONS.documentRead,
      PERMISSIONS.verificationRead,
    ]);
  });
});

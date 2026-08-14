import type { TenantContext } from '@candidate-compliance/contracts';
import { TenantRole } from '@prisma/client';

export const PERMISSIONS = {
  candidateCreate: 'candidate:create',
  candidateRead: 'candidate:read',
  candidateUpdate: 'candidate:update',
  documentCreate: 'document:create',
  documentRead: 'document:read',
  documentApprove: 'document:approve',
  documentCorrect: 'document:correct',
  verificationRequest: 'verification:request',
  verificationRead: 'verification:read',
  aiExtract: 'ai:extract',
  aiConfirm: 'ai:confirm',
  auditRead: 'audit:read',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: readonly Permission[] = Object.freeze(
  Object.values(PERMISSIONS),
);

const ROLE_PERMISSIONS = {
  [TenantRole.ADMIN]: ALL_PERMISSIONS,
  [TenantRole.RECRUITER]: [
    PERMISSIONS.candidateCreate,
    PERMISSIONS.candidateRead,
    PERMISSIONS.candidateUpdate,
    PERMISSIONS.documentCreate,
    PERMISSIONS.documentRead,
    PERMISSIONS.verificationRequest,
    PERMISSIONS.verificationRead,
    PERMISSIONS.aiExtract,
    PERMISSIONS.aiConfirm,
  ],
  [TenantRole.COMPLIANCE_OFFICER]: [
    PERMISSIONS.candidateRead,
    PERMISSIONS.documentCreate,
    PERMISSIONS.documentRead,
    PERMISSIONS.documentApprove,
    PERMISSIONS.documentCorrect,
    PERMISSIONS.verificationRequest,
    PERMISSIONS.verificationRead,
    PERMISSIONS.auditRead,
  ],
  [TenantRole.VIEWER]: [
    PERMISSIONS.candidateRead,
    PERMISSIONS.documentRead,
    PERMISSIONS.verificationRead,
  ],
} as const satisfies Record<TenantRole, readonly Permission[]>;

export function hasPermission(
  tenantContext: Pick<TenantContext, 'role'>,
  permission: Permission,
): boolean {
  return ROLE_PERMISSIONS[tenantContext.role].some(
    (grantedPermission) => grantedPermission === permission,
  );
}

import type { TenantContext } from '@candidate-compliance/contracts';
import { Prisma } from '@prisma/client';

import { canonicalHash } from '../../infrastructure/crypto/canonical-hash.js';

export const AUDIT_ACTIONS = {
  candidateCreate: 'candidate:create',
  candidateUpdate: 'candidate:update',
  candidateRead: 'candidate:read',
  candidateListRead: 'candidate:list:read',
  documentCreate: 'document:create',
  documentVersionCreate: 'document:version:create',
  documentApprove: 'document:approve',
  documentCorrect: 'document:correct',
  documentRead: 'document:read',
  documentListRead: 'document:list:read',
  documentExpiryRead: 'document:expiry:read',
  verificationRequest: 'verification:request',
  verificationRead: 'verification:read',
  verificationPending: 'verification:pending',
  verificationVerified: 'verification:verified',
  verificationFailed: 'verification:failed',
  aiExtract: 'ai:extract',
  aiRead: 'ai:read',
  aiConfirm: 'ai:confirm',
  aiReject: 'ai:reject',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export const AUDIT_RECORD_TYPES = {
  candidate: 'candidate',
  complianceDocument: 'compliance_document',
  verificationRequest: 'verification_request',
  cvExtraction: 'cv_extraction',
} as const;

export type AuditRecordType =
  (typeof AUDIT_RECORD_TYPES)[keyof typeof AUDIT_RECORD_TYPES];

interface AuditEventInput {
  action: AuditAction;
  recordType: AuditRecordType;
  recordId: string;
  before: unknown | null;
  after: unknown;
  metadata?: Prisma.InputJsonObject;
}

interface AuditReadInput {
  recordId: string;
  state: unknown;
}

type AuditContext = Pick<TenantContext, 'tenantId' | 'userId' | 'membershipId'>;

function auditData(
  tenantContext: AuditContext,
  input: AuditEventInput,
): Prisma.AuditEventCreateManyInput {
  return {
    tenantId: tenantContext.tenantId,
    actorUserId: tenantContext.userId,
    membershipId: tenantContext.membershipId,
    action: input.action,
    recordType: input.recordType,
    recordId: input.recordId,
    beforeHash: input.before === null ? null : canonicalHash(input.before),
    afterHash: canonicalHash(input.after),
    metadata: input.metadata ?? {},
  };
}

export async function appendAuditEvent(
  transaction: Prisma.TransactionClient,
  tenantContext: AuditContext,
  input: AuditEventInput,
): Promise<void> {
  await transaction.auditEvent.createMany({
    data: [auditData(tenantContext, input)],
  });
}

export async function appendReadAuditEvents(
  transaction: Prisma.TransactionClient,
  tenantContext: AuditContext,
  action: AuditAction,
  recordType: AuditRecordType,
  records: AuditReadInput[],
): Promise<void> {
  if (records.length === 0) {
    return;
  }

  await transaction.auditEvent.createMany({
    data: records.map(({ recordId, state }) =>
      auditData(tenantContext, {
        action,
        recordType,
        recordId,
        before: null,
        after: state,
      }),
    ),
  });
}

import {
  verificationRequestSchema,
  type TenantContext,
  type VerificationRequest as VerificationRequestDto,
} from '@candidate-compliance/contracts';
import {
  ComplianceDocumentStatus,
  ComplianceDocumentType,
  OutboxEventType,
  Prisma,
  type PrismaClient,
  type VerificationRequest,
} from '@prisma/client';

import { withTenantTransaction } from '../../infrastructure/database/with-tenant-transaction.js';
import {
  complianceDocumentNotFoundProblem,
  verificationAlreadyRequestedProblem,
  verificationEligibilityConflictProblem,
  verificationRequestNotFoundProblem,
} from '../../infrastructure/http/problem-details.js';
import {
  appendAuditEvent,
  AUDIT_ACTIONS,
  AUDIT_RECORD_TYPES,
} from '../audit/audit.service.js';
import {
  executeIdempotentWrite,
  IDEMPOTENCY_OPERATIONS,
  type IdempotentWriteResult,
} from '../idempotency/idempotency.service.js';

function statusValue(
  status: VerificationRequest['status'],
): Lowercase<VerificationRequest['status']> {
  return status.toLowerCase() as Lowercase<VerificationRequest['status']>;
}

export function toVerificationRequestDto(
  request: VerificationRequest,
): VerificationRequestDto {
  return verificationRequestSchema.parse({
    id: request.id,
    documentId: request.documentId,
    documentVersionId: request.documentVersionId,
    status: statusValue(request.status),
    attemptCount: request.attemptCount,
    failureCode: request.failureCode,
    requestedAt: request.requestedAt.toISOString(),
    startedAt: request.startedAt?.toISOString() ?? null,
    completedAt: request.completedAt?.toISOString() ?? null,
    updatedAt: request.updatedAt.toISOString(),
  });
}

function isUniqueConstraintConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

async function requireActiveVerificationDocumentReplay(
  transaction: Prisma.TransactionClient,
  tenantContext: TenantContext,
  request: VerificationRequestDto,
): Promise<void> {
  const active = await transaction.complianceDocument.count({
    where: {
      id: request.documentId,
      tenantId: tenantContext.tenantId,
      removedAt: null,
      candidate: { removedAt: null },
    },
  });

  if (active !== 1) {
    throw complianceDocumentNotFoundProblem();
  }
}

export async function requestRightToWorkVerification(
  prisma: PrismaClient,
  tenantContext: TenantContext,
  documentId: string,
  idempotencyKey: string,
): Promise<IdempotentWriteResult<VerificationRequestDto>> {
  try {
    return await executeIdempotentWrite({
      prisma,
      tenantContext,
      key: idempotencyKey,
      operation: IDEMPOTENCY_OPERATIONS.verificationRequest,
      fingerprintInput: { documentId },
      responseStatus: 202,
      parseResponse: (value) => verificationRequestSchema.parse(value),
      validateReplay: (transaction, verificationRequest) =>
        requireActiveVerificationDocumentReplay(
          transaction,
          tenantContext,
          verificationRequest,
        ),
      execute: async (transaction) => {
        const locked = await transaction.$queryRaw<Array<{ id: string }>>`
          SELECT document.id
          FROM public.compliance_documents AS document
          JOIN public.candidates AS candidate
            ON candidate.tenant_id = document.tenant_id
            AND candidate.id = document.candidate_id
          WHERE document.tenant_id = ${tenantContext.tenantId}::uuid
            AND document.id = ${documentId}::uuid
            AND document.removed_at IS NULL
            AND candidate.removed_at IS NULL
          FOR UPDATE OF document
        `;

        if (locked.length !== 1) {
          throw complianceDocumentNotFoundProblem();
        }

        const document = await transaction.complianceDocument.findFirst({
          where: {
            id: documentId,
            tenantId: tenantContext.tenantId,
            removedAt: null,
            candidate: { removedAt: null },
          },
          include: { currentVersion: true },
        });

        if (!document) {
          throw complianceDocumentNotFoundProblem();
        }
        if (
          document.type !== ComplianceDocumentType.RIGHT_TO_WORK ||
          !document.currentVersion ||
          document.currentVersion.status !== ComplianceDocumentStatus.APPROVED
        ) {
          throw verificationEligibilityConflictProblem();
        }

        const verificationRequest =
          await transaction.verificationRequest.create({
            data: {
              tenantId: tenantContext.tenantId,
              documentId,
              documentVersionId: document.currentVersion.id,
              requestedByUserId: tenantContext.userId,
              requestedByMembershipId: tenantContext.membershipId,
              outboxEvents: {
                create: {
                  type: OutboxEventType.RIGHT_TO_WORK_VERIFICATION_REQUESTED,
                },
              },
            },
          });
        const response = toVerificationRequestDto(verificationRequest);

        await appendAuditEvent(transaction, tenantContext, {
          action: AUDIT_ACTIONS.verificationRequest,
          recordType: AUDIT_RECORD_TYPES.verificationRequest,
          recordId: verificationRequest.id,
          before: null,
          after: response,
        });

        return response;
      },
    });
  } catch (error) {
    if (isUniqueConstraintConflict(error)) {
      throw verificationAlreadyRequestedProblem();
    }

    throw error;
  }
}

export async function getVerificationRequest(
  prisma: PrismaClient,
  tenantContext: TenantContext,
  verificationRequestId: string,
): Promise<VerificationRequestDto> {
  return withTenantTransaction(prisma, tenantContext, async (transaction) => {
    const verificationRequest = await transaction.verificationRequest.findFirst(
      {
        where: {
          id: verificationRequestId,
          tenantId: tenantContext.tenantId,
          document: {
            removedAt: null,
            candidate: { removedAt: null },
          },
        },
      },
    );

    if (!verificationRequest) {
      throw verificationRequestNotFoundProblem();
    }

    const response = toVerificationRequestDto(verificationRequest);
    await appendAuditEvent(transaction, tenantContext, {
      action: AUDIT_ACTIONS.verificationRead,
      recordType: AUDIT_RECORD_TYPES.verificationRequest,
      recordId: verificationRequest.id,
      before: null,
      after: response,
    });

    return response;
  });
}

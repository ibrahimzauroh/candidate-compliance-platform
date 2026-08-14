import type { TenantContext } from '@candidate-compliance/contracts';
import {
  VerificationStatus,
  type OutboxEvent,
  type Prisma,
  type PrismaClient,
  type VerificationRequest,
} from '@prisma/client';

import { withTenantTransaction } from '../../infrastructure/database/with-tenant-transaction.js';
import {
  appendAuditEvent,
  AUDIT_ACTIONS,
  AUDIT_RECORD_TYPES,
} from '../audit/audit.service.js';
import {
  type RightToWorkVerificationResult,
  type RightToWorkVerifier,
} from './right-to-work-verifier.js';
import { toVerificationRequestDto } from './verification.service.js';

const WORKER_ID_PATTERN = /^[A-Za-z0-9._:-]{1,100}$/;
const RETRY_ERROR_CODE = 'VERIFIER_UNAVAILABLE';
const EXHAUSTED_ERROR_CODE = 'MAX_ATTEMPTS_EXCEEDED';
const GENERIC_FAILURE_CODE = 'VERIFICATION_FAILED';
const FAILURE_CODE_PATTERN = /^[A-Z0-9_]{1,64}$/;

interface ClaimedEvent {
  outbox_event_id: string;
  tenant_id: string;
  verification_request_id: string;
  attempt_count: number;
  max_attempts: number;
  attempts_exhausted: boolean;
}

interface ProcessingState {
  request: VerificationRequest;
  expiryDate: Date | null;
}

export type VerificationProcessingResult =
  | { outcome: 'idle' }
  | { outcome: 'verified'; verificationRequestId: string }
  | { outcome: 'failed'; verificationRequestId: string }
  | { outcome: 'retry_scheduled'; verificationRequestId: string }
  | { outcome: 'already_completed'; verificationRequestId: string }
  | { outcome: 'lost_claim'; verificationRequestId: string };

interface ProcessVerificationOptions {
  prisma: PrismaClient;
  verifier: RightToWorkVerifier;
  workerId: string;
  now?: () => Date;
  retryDelayMs?: number;
}

type WorkerAuditContext = Pick<
  TenantContext,
  'tenantId' | 'userId' | 'membershipId'
>;

function auditContext(request: VerificationRequest): WorkerAuditContext {
  return {
    tenantId: request.tenantId,
    userId: request.requestedByUserId,
    membershipId: request.requestedByMembershipId,
  };
}

function safeFailureCode(failureCode: string): string {
  return FAILURE_CODE_PATTERN.test(failureCode)
    ? failureCode
    : GENERIC_FAILURE_CODE;
}

async function claimNextEvent(
  prisma: PrismaClient,
  workerId: string,
): Promise<ClaimedEvent | null> {
  if (!WORKER_ID_PATTERN.test(workerId)) {
    throw new Error('Worker ID is invalid.');
  }

  const claims = await prisma.$queryRaw<ClaimedEvent[]>`
    SELECT
      outbox_event_id,
      tenant_id,
      verification_request_id,
      attempt_count,
      max_attempts,
      attempts_exhausted
    FROM public.claim_next_verification_outbox_event(${workerId})
  `;

  return claims[0] ?? null;
}

async function lockOutboxEvent(
  transaction: Prisma.TransactionClient,
  claim: ClaimedEvent,
): Promise<OutboxEvent | null> {
  const locked = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT id
    FROM public.outbox_events
    WHERE tenant_id = ${claim.tenant_id}::uuid
      AND id = ${claim.outbox_event_id}::uuid
    FOR UPDATE
  `;

  if (locked.length !== 1) {
    return null;
  }

  return transaction.outboxEvent.findFirst({
    where: {
      id: claim.outbox_event_id,
      tenantId: claim.tenant_id,
    },
  });
}

async function markProcessed(
  transaction: Prisma.TransactionClient,
  claim: ClaimedEvent,
  processedAt: Date,
  lastErrorCode: string | null,
): Promise<void> {
  await transaction.outboxEvent.updateMany({
    where: {
      id: claim.outbox_event_id,
      tenantId: claim.tenant_id,
    },
    data: {
      processedAt,
      lockedAt: null,
      lockedUntil: null,
      lockedBy: null,
      lastErrorCode,
    },
  });
}

async function beginProcessing(
  prisma: PrismaClient,
  claim: ClaimedEvent,
  workerId: string,
  now: Date,
): Promise<ProcessingState | VerificationProcessingResult> {
  return withTenantTransaction(
    prisma,
    { tenantId: claim.tenant_id },
    async (transaction) => {
      const event = await lockOutboxEvent(transaction, claim);

      if (!event || event.processedAt || event.lockedBy !== workerId) {
        return {
          outcome: 'lost_claim',
          verificationRequestId: claim.verification_request_id,
        };
      }

      const request = await transaction.verificationRequest.findFirst({
        where: {
          id: claim.verification_request_id,
          tenantId: claim.tenant_id,
        },
        include: { documentVersion: true },
      });

      if (!request) {
        throw new Error('Claimed verification request is missing.');
      }
      if (
        request.status === VerificationStatus.VERIFIED ||
        request.status === VerificationStatus.FAILED
      ) {
        await markProcessed(transaction, claim, now, event.lastErrorCode);
        return {
          outcome: 'already_completed',
          verificationRequestId: request.id,
        };
      }

      const before = toVerificationRequestDto(request);
      const pending = await transaction.verificationRequest.update({
        where: {
          tenantId_id: {
            tenantId: claim.tenant_id,
            id: request.id,
          },
        },
        data: {
          status: VerificationStatus.PENDING,
          attemptCount: claim.attempt_count,
          startedAt: request.startedAt ?? now,
        },
      });

      if (request.status === VerificationStatus.REQUESTED) {
        await appendAuditEvent(transaction, auditContext(request), {
          action: AUDIT_ACTIONS.verificationPending,
          recordType: AUDIT_RECORD_TYPES.verificationRequest,
          recordId: request.id,
          before,
          after: toVerificationRequestDto(pending),
        });
      }

      return {
        request: pending,
        expiryDate: request.documentVersion.expiryDate,
      };
    },
  );
}

async function failExhaustedClaim(
  prisma: PrismaClient,
  claim: ClaimedEvent,
  workerId: string,
  now: Date,
): Promise<VerificationProcessingResult> {
  return withTenantTransaction(
    prisma,
    { tenantId: claim.tenant_id },
    async (transaction) => {
      const event = await lockOutboxEvent(transaction, claim);

      if (!event || event.processedAt || event.lockedBy !== workerId) {
        return {
          outcome: 'lost_claim',
          verificationRequestId: claim.verification_request_id,
        };
      }

      const request = await transaction.verificationRequest.findFirst({
        where: {
          id: claim.verification_request_id,
          tenantId: claim.tenant_id,
        },
      });

      if (!request) {
        throw new Error('Claimed verification request is missing.');
      }
      if (
        request.status === VerificationStatus.VERIFIED ||
        request.status === VerificationStatus.FAILED
      ) {
        await markProcessed(transaction, claim, now, event.lastErrorCode);
        return {
          outcome: 'already_completed',
          verificationRequestId: request.id,
        };
      }

      let pending = request;

      if (request.status === VerificationStatus.REQUESTED) {
        const before = toVerificationRequestDto(request);
        pending = await transaction.verificationRequest.update({
          where: {
            tenantId_id: {
              tenantId: claim.tenant_id,
              id: request.id,
            },
          },
          data: {
            status: VerificationStatus.PENDING,
            attemptCount: claim.attempt_count,
            startedAt: now,
          },
        });
        await appendAuditEvent(transaction, auditContext(request), {
          action: AUDIT_ACTIONS.verificationPending,
          recordType: AUDIT_RECORD_TYPES.verificationRequest,
          recordId: request.id,
          before,
          after: toVerificationRequestDto(pending),
        });
      }

      const failed = await transaction.verificationRequest.update({
        where: {
          tenantId_id: {
            tenantId: claim.tenant_id,
            id: request.id,
          },
        },
        data: {
          status: VerificationStatus.FAILED,
          attemptCount: claim.attempt_count,
          failureCode: EXHAUSTED_ERROR_CODE,
          completedAt: now,
        },
      });
      await appendAuditEvent(transaction, auditContext(request), {
        action: AUDIT_ACTIONS.verificationFailed,
        recordType: AUDIT_RECORD_TYPES.verificationRequest,
        recordId: request.id,
        before: toVerificationRequestDto(pending),
        after: toVerificationRequestDto(failed),
      });
      await markProcessed(transaction, claim, now, EXHAUSTED_ERROR_CODE);

      return { outcome: 'failed', verificationRequestId: request.id };
    },
  );
}

async function finishProcessing(
  prisma: PrismaClient,
  claim: ClaimedEvent,
  workerId: string,
  result: RightToWorkVerificationResult,
  now: Date,
): Promise<VerificationProcessingResult> {
  return withTenantTransaction(
    prisma,
    { tenantId: claim.tenant_id },
    async (transaction) => {
      const event = await lockOutboxEvent(transaction, claim);

      if (!event || event.processedAt || event.lockedBy !== workerId) {
        return {
          outcome: 'lost_claim',
          verificationRequestId: claim.verification_request_id,
        };
      }

      const request = await transaction.verificationRequest.findFirst({
        where: {
          id: claim.verification_request_id,
          tenantId: claim.tenant_id,
        },
      });

      if (!request) {
        throw new Error('Claimed verification request is missing.');
      }
      if (
        request.status === VerificationStatus.VERIFIED ||
        request.status === VerificationStatus.FAILED
      ) {
        await markProcessed(transaction, claim, now, event.lastErrorCode);
        return {
          outcome: 'already_completed',
          verificationRequestId: request.id,
        };
      }

      const before = toVerificationRequestDto(request);
      const status =
        result.outcome === 'verified'
          ? VerificationStatus.VERIFIED
          : VerificationStatus.FAILED;
      const failureCode =
        result.outcome === 'failed'
          ? safeFailureCode(result.failureCode)
          : null;
      const completed = await transaction.verificationRequest.update({
        where: {
          tenantId_id: {
            tenantId: claim.tenant_id,
            id: request.id,
          },
        },
        data: {
          status,
          attemptCount: claim.attempt_count,
          failureCode,
          completedAt: now,
        },
      });

      await appendAuditEvent(transaction, auditContext(request), {
        action:
          status === VerificationStatus.VERIFIED
            ? AUDIT_ACTIONS.verificationVerified
            : AUDIT_ACTIONS.verificationFailed,
        recordType: AUDIT_RECORD_TYPES.verificationRequest,
        recordId: request.id,
        before,
        after: toVerificationRequestDto(completed),
      });
      await markProcessed(transaction, claim, now, failureCode);

      return {
        outcome: result.outcome,
        verificationRequestId: request.id,
      };
    },
  );
}

async function handleRetryableFailure(
  prisma: PrismaClient,
  claim: ClaimedEvent,
  workerId: string,
  now: Date,
  retryDelayMs: number,
): Promise<VerificationProcessingResult> {
  return withTenantTransaction(
    prisma,
    { tenantId: claim.tenant_id },
    async (transaction) => {
      const event = await lockOutboxEvent(transaction, claim);

      if (!event || event.processedAt || event.lockedBy !== workerId) {
        return {
          outcome: 'lost_claim',
          verificationRequestId: claim.verification_request_id,
        };
      }

      const request = await transaction.verificationRequest.findFirst({
        where: {
          id: claim.verification_request_id,
          tenantId: claim.tenant_id,
        },
      });

      if (!request) {
        throw new Error('Claimed verification request is missing.');
      }
      if (claim.attempt_count >= claim.max_attempts) {
        const before = toVerificationRequestDto(request);
        const failed = await transaction.verificationRequest.update({
          where: {
            tenantId_id: {
              tenantId: claim.tenant_id,
              id: request.id,
            },
          },
          data: {
            status: VerificationStatus.FAILED,
            attemptCount: claim.attempt_count,
            failureCode: EXHAUSTED_ERROR_CODE,
            completedAt: now,
          },
        });

        await appendAuditEvent(transaction, auditContext(request), {
          action: AUDIT_ACTIONS.verificationFailed,
          recordType: AUDIT_RECORD_TYPES.verificationRequest,
          recordId: request.id,
          before,
          after: toVerificationRequestDto(failed),
        });
        await markProcessed(transaction, claim, now, EXHAUSTED_ERROR_CODE);

        return { outcome: 'failed', verificationRequestId: request.id };
      }

      await transaction.verificationRequest.update({
        where: {
          tenantId_id: {
            tenantId: claim.tenant_id,
            id: request.id,
          },
        },
        data: { attemptCount: claim.attempt_count },
      });
      await transaction.outboxEvent.updateMany({
        where: {
          id: claim.outbox_event_id,
          tenantId: claim.tenant_id,
        },
        data: {
          availableAt: new Date(now.getTime() + retryDelayMs),
          lockedAt: null,
          lockedUntil: null,
          lockedBy: null,
          lastErrorCode: RETRY_ERROR_CODE,
        },
      });

      return {
        outcome: 'retry_scheduled',
        verificationRequestId: request.id,
      };
    },
  );
}

function isProcessingState(
  value: ProcessingState | VerificationProcessingResult,
): value is ProcessingState {
  return 'request' in value;
}

export async function processNextVerificationEvent({
  prisma,
  verifier,
  workerId,
  now = () => new Date(),
  retryDelayMs = 1_000,
}: ProcessVerificationOptions): Promise<VerificationProcessingResult> {
  const claim = await claimNextEvent(prisma, workerId);

  if (!claim) {
    return { outcome: 'idle' };
  }

  if (claim.attempts_exhausted) {
    return failExhaustedClaim(prisma, claim, workerId, now());
  }

  const startedAt = now();
  const state = await beginProcessing(prisma, claim, workerId, startedAt);

  if (!isProcessingState(state)) {
    return state;
  }

  try {
    const result = await verifier.verify({
      verificationRequestId: state.request.id,
      documentVersionId: state.request.documentVersionId,
      expiryDate: state.expiryDate,
    });

    return finishProcessing(prisma, claim, workerId, result, now());
  } catch {
    return handleRetryableFailure(prisma, claim, workerId, now(), retryDelayMs);
  }
}

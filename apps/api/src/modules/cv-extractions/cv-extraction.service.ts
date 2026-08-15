import {
  cvExtractionSchema,
  cvProfileSchema,
  type ConfirmCvExtractionRequest,
  type CvExtraction,
  type TenantContext,
} from '@candidate-compliance/contracts';
import {
  CvExtractionPurpose,
  CvExtractionStatus,
  Prisma,
  type CvExtraction as CvExtractionRow,
  type PrismaClient,
} from '@prisma/client';

import { withTenantTransaction } from '../../infrastructure/database/with-tenant-transaction.js';
import {
  candidateNotFoundProblem,
  cvExtractionDecisionConflictProblem,
  cvExtractionNotFoundProblem,
  cvExtractionProviderFailureProblem,
  invalidCvExtractionResultProblem,
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
import type { CvExtractionProvider } from './cv-extraction.provider.js';
import type { ParsedCvUpload } from './cv-upload.js';

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function toCvExtraction(extraction: CvExtractionRow): CvExtraction {
  return cvExtractionSchema.parse({
    id: extraction.id,
    candidateId: extraction.candidateId,
    purpose: extraction.purpose,
    provider: extraction.provider,
    model: extraction.model,
    status: extraction.status,
    proposedOutput: extraction.proposedOutput,
    confirmedOutput: extraction.confirmedOutput,
    createdAt: extraction.createdAt.toISOString(),
    decidedAt: extraction.decidedAt?.toISOString() ?? null,
    updatedAt: extraction.updatedAt.toISOString(),
  });
}

async function requireActiveCvCandidateReplay(
  transaction: Prisma.TransactionClient,
  tenantContext: TenantContext,
  extraction: CvExtraction,
): Promise<void> {
  const active = await transaction.candidate.count({
    where: {
      id: extraction.candidateId,
      tenantId: tenantContext.tenantId,
      removedAt: null,
    },
  });

  if (active !== 1) {
    throw candidateNotFoundProblem();
  }
}

async function requireActiveCvExtractionReplay(
  transaction: Prisma.TransactionClient,
  tenantContext: TenantContext,
  extraction: CvExtraction,
): Promise<void> {
  const active = await transaction.candidate.count({
    where: {
      id: extraction.candidateId,
      tenantId: tenantContext.tenantId,
      removedAt: null,
    },
  });

  if (active !== 1) {
    throw cvExtractionNotFoundProblem();
  }
}

async function lockedExtraction(
  transaction: Prisma.TransactionClient,
  tenantContext: TenantContext,
  extractionId: string,
): Promise<CvExtractionRow> {
  const locked = await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT extraction.id
    FROM public.cv_extractions AS extraction
    JOIN public.candidates AS candidate
      ON candidate.tenant_id = extraction.tenant_id
      AND candidate.id = extraction.candidate_id
    WHERE extraction.tenant_id = ${tenantContext.tenantId}::uuid
      AND extraction.id = ${extractionId}::uuid
      AND candidate.removed_at IS NULL
    FOR UPDATE OF extraction
  `;

  if (locked.length !== 1) {
    throw cvExtractionNotFoundProblem();
  }

  const extraction = await transaction.cvExtraction.findFirst({
    where: {
      id: extractionId,
      tenantId: tenantContext.tenantId,
      candidate: { removedAt: null },
    },
  });

  if (!extraction) {
    throw cvExtractionNotFoundProblem();
  }

  return extraction;
}

export async function createCvExtraction(
  prisma: PrismaClient,
  tenantContext: TenantContext,
  candidateId: string,
  upload: ParsedCvUpload,
  provider: CvExtractionProvider,
  idempotencyKey: string,
): Promise<IdempotentWriteResult<CvExtraction>> {
  return executeIdempotentWrite({
    prisma,
    tenantContext,
    key: idempotencyKey,
    operation: IDEMPOTENCY_OPERATIONS.aiExtract,
    fingerprintInput: {
      candidateId,
      mediaType: upload.mediaType,
      contentHash: upload.contentHash,
    },
    responseStatus: 201,
    parseResponse: (value) => cvExtractionSchema.parse(value),
    validateReplay: (transaction, extraction) =>
      requireActiveCvCandidateReplay(transaction, tenantContext, extraction),
    execute: async (transaction) => {
      const candidate = await transaction.candidate.findFirst({
        where: {
          id: candidateId,
          tenantId: tenantContext.tenantId,
          removedAt: null,
        },
        select: { id: true },
      });

      if (!candidate) {
        throw candidateNotFoundProblem();
      }

      let unknownOutput: unknown;

      try {
        unknownOutput = await provider.extract(upload.text);
      } catch {
        throw cvExtractionProviderFailureProblem();
      }

      const proposedOutput = cvProfileSchema.safeParse(unknownOutput);

      if (!proposedOutput.success) {
        throw invalidCvExtractionResultProblem();
      }

      const extraction = await transaction.cvExtraction.create({
        data: {
          tenantId: tenantContext.tenantId,
          candidateId,
          requestedByUserId: tenantContext.userId,
          requestedByMembershipId: tenantContext.membershipId,
          purpose: CvExtractionPurpose.CANDIDATE_PROFILE,
          provider: provider.provider,
          model: provider.model,
          proposedOutput: jsonValue(proposedOutput.data),
        },
      });
      const response = toCvExtraction(extraction);

      await appendAuditEvent(transaction, tenantContext, {
        action: AUDIT_ACTIONS.aiExtract,
        recordType: AUDIT_RECORD_TYPES.cvExtraction,
        recordId: extraction.id,
        before: null,
        after: response,
        metadata: {
          purpose: extraction.purpose,
          provider: extraction.provider,
          model: extraction.model,
        },
      });

      return response;
    },
  });
}

export async function getCvExtraction(
  prisma: PrismaClient,
  tenantContext: TenantContext,
  extractionId: string,
): Promise<CvExtraction> {
  return withTenantTransaction(prisma, tenantContext, async (transaction) => {
    const extraction = await transaction.cvExtraction.findFirst({
      where: {
        id: extractionId,
        tenantId: tenantContext.tenantId,
        candidate: { removedAt: null },
      },
    });

    if (!extraction) {
      throw cvExtractionNotFoundProblem();
    }

    const response = toCvExtraction(extraction);
    await appendAuditEvent(transaction, tenantContext, {
      action: AUDIT_ACTIONS.aiRead,
      recordType: AUDIT_RECORD_TYPES.cvExtraction,
      recordId: extraction.id,
      before: null,
      after: response,
    });

    return response;
  });
}

export async function confirmCvExtraction(
  prisma: PrismaClient,
  tenantContext: TenantContext,
  extractionId: string,
  input: ConfirmCvExtractionRequest,
  idempotencyKey: string,
  decidedAt: Date,
): Promise<IdempotentWriteResult<CvExtraction>> {
  return executeIdempotentWrite({
    prisma,
    tenantContext,
    key: idempotencyKey,
    operation: IDEMPOTENCY_OPERATIONS.aiConfirm,
    fingerprintInput: { extractionId, input },
    responseStatus: 200,
    parseResponse: (value) => cvExtractionSchema.parse(value),
    validateReplay: (transaction, extraction) =>
      requireActiveCvExtractionReplay(transaction, tenantContext, extraction),
    execute: async (transaction) => {
      const extraction = await lockedExtraction(
        transaction,
        tenantContext,
        extractionId,
      );

      if (extraction.status !== CvExtractionStatus.PROPOSED) {
        throw cvExtractionDecisionConflictProblem();
      }

      const accepted = await transaction.cvExtraction.update({
        where: {
          tenantId_id: {
            tenantId: tenantContext.tenantId,
            id: extraction.id,
          },
        },
        data: {
          status: CvExtractionStatus.ACCEPTED,
          reviewedByUserId: tenantContext.userId,
          reviewedByMembershipId: tenantContext.membershipId,
          decidedAt,
          confirmedOutput: jsonValue(input),
        },
      });

      await transaction.candidateProfile.upsert({
        where: {
          tenantId_candidateId: {
            tenantId: tenantContext.tenantId,
            candidateId: extraction.candidateId,
          },
        },
        create: {
          tenantId: tenantContext.tenantId,
          candidateId: extraction.candidateId,
          sourceExtractionId: extraction.id,
          fullName: input.fullName,
          skills: jsonValue(input.skills),
          yearsOfExperience: input.yearsOfExperience,
          certifications: jsonValue(input.certifications),
        },
        update: {
          sourceExtractionId: extraction.id,
          fullName: input.fullName,
          skills: jsonValue(input.skills),
          yearsOfExperience: input.yearsOfExperience,
          certifications: jsonValue(input.certifications),
        },
      });

      const before = toCvExtraction(extraction);
      const after = toCvExtraction(accepted);

      await appendAuditEvent(transaction, tenantContext, {
        action: AUDIT_ACTIONS.aiConfirm,
        recordType: AUDIT_RECORD_TYPES.cvExtraction,
        recordId: extraction.id,
        before,
        after,
        metadata: { decision: 'ACCEPTED' },
      });

      return after;
    },
  });
}

export async function rejectCvExtraction(
  prisma: PrismaClient,
  tenantContext: TenantContext,
  extractionId: string,
  idempotencyKey: string,
  decidedAt: Date,
): Promise<IdempotentWriteResult<CvExtraction>> {
  return executeIdempotentWrite({
    prisma,
    tenantContext,
    key: idempotencyKey,
    operation: IDEMPOTENCY_OPERATIONS.aiReject,
    fingerprintInput: { extractionId },
    responseStatus: 200,
    parseResponse: (value) => cvExtractionSchema.parse(value),
    validateReplay: (transaction, extraction) =>
      requireActiveCvExtractionReplay(transaction, tenantContext, extraction),
    execute: async (transaction) => {
      const extraction = await lockedExtraction(
        transaction,
        tenantContext,
        extractionId,
      );

      if (extraction.status !== CvExtractionStatus.PROPOSED) {
        throw cvExtractionDecisionConflictProblem();
      }

      const rejected = await transaction.cvExtraction.update({
        where: {
          tenantId_id: {
            tenantId: tenantContext.tenantId,
            id: extraction.id,
          },
        },
        data: {
          status: CvExtractionStatus.REJECTED,
          reviewedByUserId: tenantContext.userId,
          reviewedByMembershipId: tenantContext.membershipId,
          decidedAt,
        },
      });
      const before = toCvExtraction(extraction);
      const after = toCvExtraction(rejected);

      await appendAuditEvent(transaction, tenantContext, {
        action: AUDIT_ACTIONS.aiReject,
        recordType: AUDIT_RECORD_TYPES.cvExtraction,
        recordId: extraction.id,
        before,
        after,
        metadata: { decision: 'REJECTED' },
      });

      return after;
    },
  });
}

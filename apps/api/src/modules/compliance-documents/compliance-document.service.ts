import {
  complianceDocumentSchema,
  type CandidateDocumentListQuery,
  type CandidateDocumentListResponse,
  type ComplianceDocument as ComplianceDocumentDto,
  type ComplianceDocumentVersion as ComplianceDocumentVersionDto,
  type CorrectComplianceDocumentRequest,
  type CreateComplianceDocumentRequest,
  type CreateComplianceDocumentVersionRequest,
  type ExpiringComplianceDocumentListQuery,
  type ExpiringComplianceDocumentListResponse,
  type NoContentResponse,
  type TenantContext,
} from '@candidate-compliance/contracts';
import { noContentResponseSchema } from '@candidate-compliance/contracts';
import {
  ComplianceDocumentStatus,
  Prisma,
  type ComplianceDocument,
  type ComplianceDocumentVersion,
  type PrismaClient,
} from '@prisma/client';

import { withTenantTransaction } from '../../infrastructure/database/with-tenant-transaction.js';
import {
  approvedDocumentVersionConflictProblem,
  candidateNotFoundProblem,
  complianceDocumentNotFoundProblem,
  documentApprovalConflictProblem,
  documentCorrectionConflictProblem,
  documentVersionConflictProblem,
} from '../../infrastructure/http/problem-details.js';
import {
  appendAuditEvent,
  appendReadAuditEvents,
  AUDIT_ACTIONS,
  AUDIT_RECORD_TYPES,
} from '../audit/audit.service.js';
import {
  executeIdempotentWrite,
  IDEMPOTENCY_OPERATIONS,
  type IdempotentWriteResult,
} from '../idempotency/idempotency.service.js';

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

function documentDateFingerprint(input: {
  issueDate?: string | null;
  expiryDate?: string | null;
}) {
  return {
    issueDate: input.issueDate ?? null,
    expiryDate: input.expiryDate ?? null,
  };
}

function toDateString(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function toVersion(
  version: ComplianceDocumentVersion,
): ComplianceDocumentVersionDto {
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    issueDate: toDateString(version.issueDate),
    expiryDate: toDateString(version.expiryDate),
    status: version.status,
    createdAt: version.createdAt.toISOString(),
  };
}

function toDocument(
  document: ComplianceDocument,
  currentVersion: ComplianceDocumentVersion | null,
): ComplianceDocumentDto {
  if (!currentVersion) {
    throw new Error('Compliance document current version is missing.');
  }

  return {
    id: document.id,
    candidateId: document.candidateId,
    type: document.type,
    currentVersion: toVersion(currentVersion),
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

function isUniqueConstraintConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

async function requireActiveDocumentReplay(
  transaction: Prisma.TransactionClient,
  tenantContext: TenantContext,
  document: ComplianceDocumentDto,
): Promise<void> {
  const active = await transaction.complianceDocument.count({
    where: {
      id: document.id,
      tenantId: tenantContext.tenantId,
      removedAt: null,
      candidate: { removedAt: null },
    },
  });

  if (active !== 1) {
    throw complianceDocumentNotFoundProblem();
  }
}

async function requireCandidate(
  transaction: Prisma.TransactionClient,
  tenantContext: TenantContext,
  candidateId: string,
): Promise<void> {
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
}

async function lockCurrentDocumentVersion(
  transaction: Prisma.TransactionClient,
  tenantContext: TenantContext,
  documentId: string,
): Promise<{
  document: ComplianceDocument;
  currentVersion: ComplianceDocumentVersion;
}> {
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
  });

  if (!document) {
    throw complianceDocumentNotFoundProblem();
  }
  if (!document.currentVersionId) {
    throw new Error('Compliance document current version is missing.');
  }

  const currentVersion = await transaction.complianceDocumentVersion.findFirst({
    where: {
      id: document.currentVersionId,
      documentId,
      tenantId: tenantContext.tenantId,
    },
  });

  if (!currentVersion) {
    throw new Error('Compliance document current version is missing.');
  }

  return { document, currentVersion };
}

export async function createComplianceDocument(
  prisma: PrismaClient,
  tenantContext: TenantContext,
  candidateId: string,
  input: CreateComplianceDocumentRequest,
  idempotencyKey: string,
): Promise<IdempotentWriteResult<ComplianceDocumentDto>> {
  return executeIdempotentWrite({
    prisma,
    tenantContext,
    key: idempotencyKey,
    operation: IDEMPOTENCY_OPERATIONS.documentCreate,
    fingerprintInput: {
      candidateId,
      input: {
        type: input.type,
        ...documentDateFingerprint(input),
      },
    },
    responseStatus: 201,
    parseResponse: (value) => complianceDocumentSchema.parse(value),
    validateReplay: (transaction, document) =>
      requireActiveDocumentReplay(transaction, tenantContext, document),
    execute: async (transaction) => {
      await requireCandidate(transaction, tenantContext, candidateId);

      const document = await transaction.complianceDocument.create({
        data: {
          tenantId: tenantContext.tenantId,
          candidateId,
          type: input.type,
        },
      });
      const version = await transaction.complianceDocumentVersion.create({
        data: {
          tenantId: tenantContext.tenantId,
          documentId: document.id,
          versionNumber: 1,
          issueDate: toDate(input.issueDate),
          expiryDate: toDate(input.expiryDate),
          status: ComplianceDocumentStatus.DRAFT,
          supersedesVersionId: null,
          createdBy: tenantContext.membershipId,
        },
      });
      const currentDocument = await transaction.complianceDocument.update({
        where: {
          tenantId_id: {
            tenantId: tenantContext.tenantId,
            id: document.id,
          },
        },
        data: { currentVersionId: version.id },
      });
      const created = toDocument(currentDocument, version);

      await appendAuditEvent(transaction, tenantContext, {
        action: AUDIT_ACTIONS.documentCreate,
        recordType: AUDIT_RECORD_TYPES.complianceDocument,
        recordId: created.id,
        before: null,
        after: created,
      });

      return created;
    },
  });
}

export async function listCandidateComplianceDocuments(
  prisma: PrismaClient,
  tenantContext: TenantContext,
  candidateId: string,
  query: CandidateDocumentListQuery,
): Promise<CandidateDocumentListResponse> {
  return withTenantTransaction(prisma, tenantContext, async (transaction) => {
    await requireCandidate(transaction, tenantContext, candidateId);

    const where: Prisma.ComplianceDocumentWhereInput = {
      tenantId: tenantContext.tenantId,
      candidateId,
      removedAt: null,
      ...(query.type ? { type: query.type } : {}),
      ...(query.status
        ? {
            currentVersion: {
              is: {
                tenantId: tenantContext.tenantId,
                status: query.status,
              },
            },
          }
        : {}),
    };
    const totalItems = await transaction.complianceDocument.count({ where });
    const documents = await transaction.complianceDocument.findMany({
      where,
      include: { currentVersion: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    const items = documents.map((document) =>
      toDocument(document, document.currentVersion),
    );

    await appendReadAuditEvents(
      transaction,
      tenantContext,
      AUDIT_ACTIONS.documentListRead,
      AUDIT_RECORD_TYPES.complianceDocument,
      items.map((document) => ({
        recordId: document.id,
        state: document,
      })),
    );

    return {
      items,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / query.pageSize),
      },
    };
  });
}

export async function getComplianceDocument(
  prisma: PrismaClient,
  tenantContext: TenantContext,
  documentId: string,
): Promise<ComplianceDocumentDto> {
  return withTenantTransaction(prisma, tenantContext, async (transaction) => {
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
    const result = toDocument(document, document.currentVersion);

    await appendAuditEvent(transaction, tenantContext, {
      action: AUDIT_ACTIONS.documentRead,
      recordType: AUDIT_RECORD_TYPES.complianceDocument,
      recordId: result.id,
      before: null,
      after: result,
    });

    return result;
  });
}

function utcExpiryWindow(now: Date): { start: Date; end: Date } {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 30);

  return { start, end };
}

export async function listExpiringComplianceDocuments(
  prisma: PrismaClient,
  tenantContext: TenantContext,
  query: ExpiringComplianceDocumentListQuery,
  now: Date = new Date(),
): Promise<ExpiringComplianceDocumentListResponse> {
  return withTenantTransaction(prisma, tenantContext, async (transaction) => {
    const { start, end } = utcExpiryWindow(now);
    const where: Prisma.ComplianceDocumentWhereInput = {
      tenantId: tenantContext.tenantId,
      removedAt: null,
      candidate: { removedAt: null },
      ...(query.type ? { type: query.type } : {}),
      currentVersion: {
        is: {
          tenantId: tenantContext.tenantId,
          expiryDate: {
            gte: start,
            lte: end,
          },
          ...(query.status ? { status: query.status } : {}),
        },
      },
    };
    const totalItems = await transaction.complianceDocument.count({ where });
    const documents = await transaction.complianceDocument.findMany({
      where,
      include: { currentVersion: true },
      orderBy: [{ currentVersion: { expiryDate: 'asc' } }, { id: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    const items = documents.map((document) =>
      toDocument(document, document.currentVersion),
    );

    await appendReadAuditEvents(
      transaction,
      tenantContext,
      AUDIT_ACTIONS.documentExpiryRead,
      AUDIT_RECORD_TYPES.complianceDocument,
      items.map((document) => ({
        recordId: document.id,
        state: document,
      })),
    );

    return {
      items,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / query.pageSize),
      },
    };
  });
}

export async function addComplianceDocumentVersion(
  prisma: PrismaClient,
  tenantContext: TenantContext,
  documentId: string,
  input: CreateComplianceDocumentVersionRequest,
  idempotencyKey: string,
): Promise<IdempotentWriteResult<ComplianceDocumentDto>> {
  try {
    return await executeIdempotentWrite({
      prisma,
      tenantContext,
      key: idempotencyKey,
      operation: IDEMPOTENCY_OPERATIONS.documentVersionCreate,
      fingerprintInput: {
        documentId,
        input: documentDateFingerprint(input),
      },
      responseStatus: 201,
      parseResponse: (value) => complianceDocumentSchema.parse(value),
      validateReplay: (transaction, document) =>
        requireActiveDocumentReplay(transaction, tenantContext, document),
      execute: async (transaction) => {
        const { document, currentVersion } = await lockCurrentDocumentVersion(
          transaction,
          tenantContext,
          documentId,
        );

        if (currentVersion.status === ComplianceDocumentStatus.APPROVED) {
          throw approvedDocumentVersionConflictProblem();
        }

        const latestVersion =
          await transaction.complianceDocumentVersion.aggregate({
            where: {
              documentId,
              tenantId: tenantContext.tenantId,
            },
            _max: { versionNumber: true },
          });

        if (latestVersion._max.versionNumber === null) {
          throw new Error('Compliance document current version is missing.');
        }
        const before = toDocument(document, currentVersion);

        const version = await transaction.complianceDocumentVersion.create({
          data: {
            tenantId: tenantContext.tenantId,
            documentId,
            versionNumber: latestVersion._max.versionNumber + 1,
            issueDate: toDate(input.issueDate),
            expiryDate: toDate(input.expiryDate),
            status: ComplianceDocumentStatus.DRAFT,
            supersedesVersionId: currentVersion.id,
            createdBy: tenantContext.membershipId,
          },
        });
        const currentDocument = await transaction.complianceDocument.update({
          where: {
            tenantId_id: {
              tenantId: tenantContext.tenantId,
              id: documentId,
            },
          },
          data: { currentVersionId: version.id },
        });
        const after = toDocument(currentDocument, version);

        await appendAuditEvent(transaction, tenantContext, {
          action: AUDIT_ACTIONS.documentVersionCreate,
          recordType: AUDIT_RECORD_TYPES.complianceDocument,
          recordId: documentId,
          before,
          after,
        });

        return after;
      },
    });
  } catch (error) {
    if (isUniqueConstraintConflict(error)) {
      throw documentVersionConflictProblem();
    }

    throw error;
  }
}

export async function approveComplianceDocument(
  prisma: PrismaClient,
  tenantContext: TenantContext,
  documentId: string,
  idempotencyKey: string,
): Promise<IdempotentWriteResult<ComplianceDocumentDto>> {
  return executeIdempotentWrite({
    prisma,
    tenantContext,
    key: idempotencyKey,
    operation: IDEMPOTENCY_OPERATIONS.documentApprove,
    fingerprintInput: { documentId },
    responseStatus: 200,
    parseResponse: (value) => complianceDocumentSchema.parse(value),
    validateReplay: (transaction, document) =>
      requireActiveDocumentReplay(transaction, tenantContext, document),
    execute: async (transaction) => {
      const { document, currentVersion } = await lockCurrentDocumentVersion(
        transaction,
        tenantContext,
        documentId,
      );

      if (currentVersion.status === ComplianceDocumentStatus.APPROVED) {
        return toDocument(document, currentVersion);
      }
      if (
        currentVersion.status !== ComplianceDocumentStatus.DRAFT &&
        currentVersion.status !== ComplianceDocumentStatus.PENDING_REVIEW
      ) {
        throw documentApprovalConflictProblem();
      }

      const before = toDocument(document, currentVersion);
      const approvedVersion =
        await transaction.complianceDocumentVersion.update({
          where: {
            tenantId_documentId_id: {
              tenantId: tenantContext.tenantId,
              documentId,
              id: currentVersion.id,
            },
          },
          data: { status: ComplianceDocumentStatus.APPROVED },
        });
      const after = toDocument(document, approvedVersion);

      await appendAuditEvent(transaction, tenantContext, {
        action: AUDIT_ACTIONS.documentApprove,
        recordType: AUDIT_RECORD_TYPES.complianceDocument,
        recordId: documentId,
        before,
        after,
      });

      return after;
    },
  });
}

export async function correctComplianceDocument(
  prisma: PrismaClient,
  tenantContext: TenantContext,
  documentId: string,
  input: CorrectComplianceDocumentRequest,
  idempotencyKey: string,
): Promise<IdempotentWriteResult<ComplianceDocumentDto>> {
  try {
    return await executeIdempotentWrite({
      prisma,
      tenantContext,
      key: idempotencyKey,
      operation: IDEMPOTENCY_OPERATIONS.documentCorrect,
      fingerprintInput: { documentId, input },
      responseStatus: 201,
      parseResponse: (value) => complianceDocumentSchema.parse(value),
      validateReplay: (transaction, document) =>
        requireActiveDocumentReplay(transaction, tenantContext, document),
      execute: async (transaction) => {
        const { document, currentVersion } = await lockCurrentDocumentVersion(
          transaction,
          tenantContext,
          documentId,
        );

        if (currentVersion.status !== ComplianceDocumentStatus.APPROVED) {
          throw documentCorrectionConflictProblem();
        }

        const latestVersion =
          await transaction.complianceDocumentVersion.aggregate({
            where: {
              documentId,
              tenantId: tenantContext.tenantId,
            },
            _max: { versionNumber: true },
          });

        if (latestVersion._max.versionNumber === null) {
          throw new Error('Compliance document current version is missing.');
        }

        const before = toDocument(document, currentVersion);
        const correctedVersion =
          await transaction.complianceDocumentVersion.create({
            data: {
              tenantId: tenantContext.tenantId,
              documentId,
              versionNumber: latestVersion._max.versionNumber + 1,
              issueDate: toDate(input.issueDate),
              expiryDate: toDate(input.expiryDate),
              status: ComplianceDocumentStatus.DRAFT,
              supersedesVersionId: currentVersion.id,
              createdBy: tenantContext.membershipId,
            },
          });
        const currentDocument = await transaction.complianceDocument.update({
          where: {
            tenantId_id: {
              tenantId: tenantContext.tenantId,
              id: documentId,
            },
          },
          data: { currentVersionId: correctedVersion.id },
        });
        const after = toDocument(currentDocument, correctedVersion);

        await appendAuditEvent(transaction, tenantContext, {
          action: AUDIT_ACTIONS.documentCorrect,
          recordType: AUDIT_RECORD_TYPES.complianceDocument,
          recordId: documentId,
          before,
          after,
        });

        return after;
      },
    });
  } catch (error) {
    if (isUniqueConstraintConflict(error)) {
      throw documentVersionConflictProblem();
    }

    throw error;
  }
}

export async function removeComplianceDocument(
  prisma: PrismaClient,
  tenantContext: TenantContext,
  documentId: string,
  idempotencyKey: string,
): Promise<IdempotentWriteResult<NoContentResponse>> {
  return executeIdempotentWrite({
    prisma,
    tenantContext,
    key: idempotencyKey,
    operation: IDEMPOTENCY_OPERATIONS.documentRemove,
    fingerprintInput: { documentId },
    responseStatus: 204,
    parseResponse: (value) => noContentResponseSchema.parse(value),
    execute: async (transaction) => {
      const { document, currentVersion } = await lockCurrentDocumentVersion(
        transaction,
        tenantContext,
        documentId,
      );
      const removedDocument = await transaction.complianceDocument.update({
        where: {
          tenantId_id: {
            tenantId: tenantContext.tenantId,
            id: documentId,
          },
        },
        data: { removedAt: new Date() },
      });

      await appendAuditEvent(transaction, tenantContext, {
        action: AUDIT_ACTIONS.documentRemove,
        recordType: AUDIT_RECORD_TYPES.complianceDocument,
        recordId: documentId,
        before: {
          ...toDocument(document, currentVersion),
          removedAt: null,
        },
        after: {
          ...toDocument(removedDocument, currentVersion),
          removedAt: removedDocument.removedAt?.toISOString() ?? null,
        },
      });

      return {};
    },
  });
}

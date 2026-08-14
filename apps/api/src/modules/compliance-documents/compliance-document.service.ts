import {
  complianceDocumentSchema,
  type CandidateDocumentListQuery,
  type CandidateDocumentListResponse,
  type ComplianceDocument as ComplianceDocumentDto,
  type ComplianceDocumentVersion as ComplianceDocumentVersionDto,
  type CreateComplianceDocumentRequest,
  type CreateComplianceDocumentVersionRequest,
  type ExpiringComplianceDocumentListQuery,
  type ExpiringComplianceDocumentListResponse,
  type TenantContext,
} from '@candidate-compliance/contracts';
import {
  ComplianceDocumentStatus,
  Prisma,
  type ComplianceDocument,
  type ComplianceDocumentVersion,
  type PrismaClient,
} from '@prisma/client';

import { withTenantTransaction } from '../../infrastructure/database/with-tenant-transaction.js';
import {
  candidateNotFoundProblem,
  complianceDocumentNotFoundProblem,
  documentVersionConflictProblem,
} from '../../infrastructure/http/problem-details.js';
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

async function requireCandidate(
  transaction: Prisma.TransactionClient,
  tenantContext: TenantContext,
  candidateId: string,
): Promise<void> {
  const candidate = await transaction.candidate.findFirst({
    where: {
      id: candidateId,
      tenantId: tenantContext.tenantId,
    },
    select: { id: true },
  });

  if (!candidate) {
    throw candidateNotFoundProblem();
  }
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

      return toDocument(currentDocument, version);
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

    return {
      items: documents.map((document) =>
        toDocument(document, document.currentVersion),
      ),
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
      },
      include: { currentVersion: true },
    });

    if (!document) {
      throw complianceDocumentNotFoundProblem();
    }

    return toDocument(document, document.currentVersion);
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

    return {
      items: documents.map((document) =>
        toDocument(document, document.currentVersion),
      ),
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
      execute: async (transaction) => {
        const document = await transaction.complianceDocument.findFirst({
          where: {
            id: documentId,
            tenantId: tenantContext.tenantId,
          },
        });

        if (!document) {
          throw complianceDocumentNotFoundProblem();
        }
        if (!document.currentVersionId) {
          throw new Error('Compliance document current version is missing.');
        }

        const currentVersion =
          await transaction.complianceDocumentVersion.findFirst({
            where: {
              id: document.currentVersionId,
              documentId,
              tenantId: tenantContext.tenantId,
            },
          });
        const latestVersion =
          await transaction.complianceDocumentVersion.aggregate({
            where: {
              documentId,
              tenantId: tenantContext.tenantId,
            },
            _max: { versionNumber: true },
          });

        if (!currentVersion || latestVersion._max.versionNumber === null) {
          throw new Error('Compliance document current version is missing.');
        }

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

        return toDocument(currentDocument, version);
      },
    });
  } catch (error) {
    if (isUniqueConstraintConflict(error)) {
      throw documentVersionConflictProblem();
    }

    throw error;
  }
}

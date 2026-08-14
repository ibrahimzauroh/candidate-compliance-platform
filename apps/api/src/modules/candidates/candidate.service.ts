import type {
  Candidate,
  CandidateListQuery,
  CandidateListResponse,
  CreateCandidateRequest,
  TenantContext,
  UpdateCandidateRequest,
} from '@candidate-compliance/contracts';
import { candidateSchema } from '@candidate-compliance/contracts';
import { Prisma, type PrismaClient } from '@prisma/client';

import { withTenantTransaction } from '../../infrastructure/database/with-tenant-transaction.js';
import {
  candidateEmailConflictProblem,
  candidateNotFoundProblem,
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

function toCandidate(candidate: {
  id: string;
  fullName: string;
  email: string;
  roleAppliedFor: string;
  createdAt: Date;
  updatedAt: Date;
}): Candidate {
  return {
    id: candidate.id,
    fullName: candidate.fullName,
    email: candidate.email,
    roleAppliedFor: candidate.roleAppliedFor,
    createdAt: candidate.createdAt.toISOString(),
    updatedAt: candidate.updatedAt.toISOString(),
  };
}

function isUniqueConstraintConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function candidateWhere(
  tenantContext: TenantContext,
  query: CandidateListQuery,
): Prisma.CandidateWhereInput {
  return {
    tenantId: tenantContext.tenantId,
    ...(query.email ? { email: query.email } : {}),
    ...(query.roleAppliedFor
      ? {
          roleAppliedFor: {
            contains: query.roleAppliedFor,
            mode: 'insensitive',
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { fullName: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
            {
              roleAppliedFor: {
                contains: query.search,
                mode: 'insensitive',
              },
            },
          ],
        }
      : {}),
  };
}

export async function createCandidate(
  prisma: PrismaClient,
  tenantContext: TenantContext,
  input: CreateCandidateRequest,
  idempotencyKey: string,
): Promise<IdempotentWriteResult<Candidate>> {
  try {
    return await executeIdempotentWrite({
      prisma,
      tenantContext,
      key: idempotencyKey,
      operation: IDEMPOTENCY_OPERATIONS.candidateCreate,
      fingerprintInput: { input },
      responseStatus: 201,
      parseResponse: (value) => candidateSchema.parse(value),
      execute: async (transaction) => {
        const candidate = await transaction.candidate.create({
          data: {
            tenantId: tenantContext.tenantId,
            fullName: input.fullName,
            email: input.email,
            roleAppliedFor: input.roleAppliedFor,
          },
        });
        const created = toCandidate(candidate);

        await appendAuditEvent(transaction, tenantContext, {
          action: AUDIT_ACTIONS.candidateCreate,
          recordType: AUDIT_RECORD_TYPES.candidate,
          recordId: created.id,
          before: null,
          after: created,
        });

        return created;
      },
    });
  } catch (error) {
    if (isUniqueConstraintConflict(error)) {
      throw candidateEmailConflictProblem();
    }

    throw error;
  }
}

export async function listCandidates(
  prisma: PrismaClient,
  tenantContext: TenantContext,
  query: CandidateListQuery,
): Promise<CandidateListResponse> {
  return withTenantTransaction(prisma, tenantContext, async (transaction) => {
    const where = candidateWhere(tenantContext, query);
    const totalItems = await transaction.candidate.count({ where });
    const candidates = await transaction.candidate.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    const items = candidates.map(toCandidate);

    await appendReadAuditEvents(
      transaction,
      tenantContext,
      AUDIT_ACTIONS.candidateListRead,
      AUDIT_RECORD_TYPES.candidate,
      items.map((candidate) => ({
        recordId: candidate.id,
        state: candidate,
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

export async function getCandidate(
  prisma: PrismaClient,
  tenantContext: TenantContext,
  candidateId: string,
): Promise<Candidate> {
  return withTenantTransaction(prisma, tenantContext, async (transaction) => {
    const candidate = await transaction.candidate.findFirst({
      where: {
        id: candidateId,
        tenantId: tenantContext.tenantId,
      },
    });

    if (!candidate) {
      throw candidateNotFoundProblem();
    }
    const result = toCandidate(candidate);

    await appendAuditEvent(transaction, tenantContext, {
      action: AUDIT_ACTIONS.candidateRead,
      recordType: AUDIT_RECORD_TYPES.candidate,
      recordId: result.id,
      before: null,
      after: result,
    });

    return result;
  });
}

export async function updateCandidate(
  prisma: PrismaClient,
  tenantContext: TenantContext,
  candidateId: string,
  input: UpdateCandidateRequest,
  idempotencyKey: string,
): Promise<IdempotentWriteResult<Candidate>> {
  try {
    return await executeIdempotentWrite({
      prisma,
      tenantContext,
      key: idempotencyKey,
      operation: IDEMPOTENCY_OPERATIONS.candidateUpdate,
      fingerprintInput: { candidateId, input },
      responseStatus: 200,
      parseResponse: (value) => candidateSchema.parse(value),
      execute: async (transaction) => {
        const beforeCandidate = await transaction.candidate.findFirst({
          where: {
            id: candidateId,
            tenantId: tenantContext.tenantId,
          },
        });

        if (!beforeCandidate) {
          throw candidateNotFoundProblem();
        }

        const data: Prisma.CandidateUpdateManyMutationInput = {};

        if (input.fullName !== undefined) {
          data.fullName = input.fullName;
        }
        if (input.email !== undefined) {
          data.email = input.email;
        }
        if (input.roleAppliedFor !== undefined) {
          data.roleAppliedFor = input.roleAppliedFor;
        }

        const result = await transaction.candidate.updateMany({
          where: {
            id: candidateId,
            tenantId: tenantContext.tenantId,
          },
          data,
        });

        if (result.count !== 1) {
          throw candidateNotFoundProblem();
        }

        const candidate = await transaction.candidate.findFirst({
          where: {
            id: candidateId,
            tenantId: tenantContext.tenantId,
          },
        });

        if (!candidate) {
          throw candidateNotFoundProblem();
        }
        const before = toCandidate(beforeCandidate);
        const after = toCandidate(candidate);

        await appendAuditEvent(transaction, tenantContext, {
          action: AUDIT_ACTIONS.candidateUpdate,
          recordType: AUDIT_RECORD_TYPES.candidate,
          recordId: candidateId,
          before,
          after,
        });

        return after;
      },
    });
  } catch (error) {
    if (isUniqueConstraintConflict(error)) {
      throw candidateEmailConflictProblem();
    }

    throw error;
  }
}

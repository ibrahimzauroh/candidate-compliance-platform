import type {
  Candidate,
  CandidateListQuery,
  CandidateListResponse,
  CreateCandidateRequest,
  TenantContext,
  UpdateCandidateRequest,
} from '@candidate-compliance/contracts';
import { Prisma, type PrismaClient } from '@prisma/client';

import { withTenantTransaction } from '../../infrastructure/database/with-tenant-transaction.js';
import {
  candidateEmailConflictProblem,
  candidateNotFoundProblem,
} from '../../infrastructure/http/problem-details.js';

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
): Promise<Candidate> {
  try {
    return await withTenantTransaction(
      prisma,
      tenantContext,
      async (transaction) => {
        const candidate = await transaction.candidate.create({
          data: {
            tenantId: tenantContext.tenantId,
            fullName: input.fullName,
            email: input.email,
            roleAppliedFor: input.roleAppliedFor,
          },
        });

        return toCandidate(candidate);
      },
    );
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

    return {
      items: candidates.map(toCandidate),
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

    return toCandidate(candidate);
  });
}

export async function updateCandidate(
  prisma: PrismaClient,
  tenantContext: TenantContext,
  candidateId: string,
  input: UpdateCandidateRequest,
): Promise<Candidate> {
  try {
    return await withTenantTransaction(
      prisma,
      tenantContext,
      async (transaction) => {
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

        return toCandidate(candidate);
      },
    );
  } catch (error) {
    if (isUniqueConstraintConflict(error)) {
      throw candidateEmailConflictProblem();
    }

    throw error;
  }
}

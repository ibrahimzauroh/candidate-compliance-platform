import {
  idempotencyKeySchema,
  type TenantContext,
} from '@candidate-compliance/contracts';
import { Prisma, type PrismaClient } from '@prisma/client';

import { canonicalHash } from '../../infrastructure/crypto/canonical-hash.js';
import { withTenantTransaction } from '../../infrastructure/database/with-tenant-transaction.js';
import {
  idempotencyKeyConflictProblem,
  idempotencyKeyRequiredProblem,
  invalidIdempotencyKeyProblem,
} from '../../infrastructure/http/problem-details.js';

export const IDEMPOTENCY_OPERATIONS = {
  candidateCreate: 'candidate:create',
  candidateUpdate: 'candidate:update',
  documentCreate: 'document:create',
  documentVersionCreate: 'document:version:create',
} as const;

export type IdempotencyOperation =
  (typeof IDEMPOTENCY_OPERATIONS)[keyof typeof IDEMPOTENCY_OPERATIONS];

export interface IdempotentWriteResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

interface IdempotentWriteOptions<T> {
  prisma: PrismaClient;
  tenantContext: TenantContext;
  key: string;
  operation: IdempotencyOperation;
  fingerprintInput: unknown;
  responseStatus: number;
  parseResponse: (value: unknown) => T;
  execute: (transaction: Prisma.TransactionClient) => Promise<T>;
}

interface StoredResult {
  requestHash: string;
  responseStatus: number;
  responseBody: Prisma.JsonValue;
}

export function parseIdempotencyKey(value: string | undefined): string {
  if (value === undefined) {
    throw idempotencyKeyRequiredProblem();
  }

  const parsed = idempotencyKeySchema.safeParse(value);

  if (!parsed.success) {
    throw invalidIdempotencyKeyProblem();
  }

  return parsed.data;
}

function storedResponse<T>(
  record: StoredResult,
  expectedHash: string,
  parseResponse: (value: unknown) => T,
): IdempotentWriteResult<T> {
  if (record.requestHash !== expectedHash) {
    throw idempotencyKeyConflictProblem();
  }

  return {
    status: record.responseStatus,
    body: parseResponse(record.responseBody),
    replayed: true,
  };
}

function isUniqueConstraintConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function jsonBody(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function findStoredResult(
  transaction: Prisma.TransactionClient,
  tenantContext: TenantContext,
  operation: IdempotencyOperation,
  key: string,
): Promise<StoredResult | null> {
  return transaction.idempotencyRecord.findFirst({
    where: {
      tenantId: tenantContext.tenantId,
      membershipId: tenantContext.membershipId,
      operation,
      key,
    },
    select: {
      requestHash: true,
      responseStatus: true,
      responseBody: true,
    },
  });
}

export async function executeIdempotentWrite<T>({
  prisma,
  tenantContext,
  key,
  operation,
  fingerprintInput,
  responseStatus,
  parseResponse,
  execute,
}: IdempotentWriteOptions<T>): Promise<IdempotentWriteResult<T>> {
  const expectedHash = canonicalHash(fingerprintInput);

  try {
    return await withTenantTransaction(
      prisma,
      tenantContext,
      async (transaction) => {
        const existing = await findStoredResult(
          transaction,
          tenantContext,
          operation,
          key,
        );

        if (existing) {
          return storedResponse(existing, expectedHash, parseResponse);
        }

        const body = parseResponse(await execute(transaction));
        await transaction.idempotencyRecord.create({
          data: {
            tenantId: tenantContext.tenantId,
            membershipId: tenantContext.membershipId,
            operation,
            key,
            requestHash: expectedHash,
            responseStatus,
            responseBody: jsonBody(body),
          },
        });

        return { status: responseStatus, body, replayed: false };
      },
    );
  } catch (error) {
    if (!isUniqueConstraintConflict(error)) {
      throw error;
    }

    const existing = await withTenantTransaction(
      prisma,
      tenantContext,
      (transaction) =>
        findStoredResult(transaction, tenantContext, operation, key),
    );

    if (existing) {
      return storedResponse(existing, expectedHash, parseResponse);
    }

    throw error;
  }
}

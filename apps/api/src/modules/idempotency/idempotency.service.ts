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
  candidateRemove: 'candidate:remove',
  documentCreate: 'document:create',
  documentVersionCreate: 'document:version:create',
  documentApprove: 'document:approve',
  documentCorrect: 'document:correct',
  documentRemove: 'document:remove',
  verificationRequest: 'verification:request',
  aiExtract: 'ai:extract',
  aiConfirm: 'ai:confirm',
  aiReject: 'ai:reject',
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
  validateReplay?: (
    transaction: Prisma.TransactionClient,
    body: T,
  ) => Promise<void>;
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

async function storedResponse<T>(
  transaction: Prisma.TransactionClient,
  record: StoredResult,
  expectedHash: string,
  parseResponse: (value: unknown) => T,
  validateReplay?: (
    transaction: Prisma.TransactionClient,
    body: T,
  ) => Promise<void>,
): Promise<IdempotentWriteResult<T>> {
  if (record.requestHash !== expectedHash) {
    throw idempotencyKeyConflictProblem();
  }

  const body = parseResponse(record.responseBody);
  await validateReplay?.(transaction, body);

  return {
    status: record.responseStatus,
    body,
    replayed: true,
  };
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
  validateReplay,
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
          return storedResponse(
            transaction,
            existing,
            expectedHash,
            parseResponse,
            validateReplay,
          );
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
    const replay = await withTenantTransaction(
      prisma,
      tenantContext,
      async (transaction) => {
        const existing = await findStoredResult(
          transaction,
          tenantContext,
          operation,
          key,
        );

        return existing
          ? storedResponse(
              transaction,
              existing,
              expectedHash,
              parseResponse,
              validateReplay,
            )
          : null;
      },
    );

    if (replay) {
      return replay;
    }

    throw error;
  }
}

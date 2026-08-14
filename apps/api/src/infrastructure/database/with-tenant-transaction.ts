import type { TenantContext } from '@candidate-compliance/contracts';
import { Prisma, type PrismaClient } from '@prisma/client';

export async function withTenantTransaction<T>(
  prisma: PrismaClient,
  tenantContext: Pick<TenantContext, 'tenantId'>,
  callback: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT pg_catalog.set_config(
        'app.current_tenant_id',
        ${tenantContext.tenantId},
        true
      )
    `;

    return callback(transaction);
  });
}

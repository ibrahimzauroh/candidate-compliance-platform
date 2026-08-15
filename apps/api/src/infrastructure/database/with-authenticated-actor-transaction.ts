import type { AuthenticatedActor } from '@candidate-compliance/contracts';
import { Prisma, type PrismaClient } from '@prisma/client';

export async function withAuthenticatedActorTransaction<T>(
  prisma: PrismaClient,
  actor: Pick<AuthenticatedActor, 'userId'>,
  callback: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT pg_catalog.set_config(
        'app.current_actor_user_id',
        ${actor.userId},
        true
      )
    `;

    return callback(transaction);
  });
}

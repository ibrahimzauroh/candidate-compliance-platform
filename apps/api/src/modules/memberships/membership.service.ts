import type {
  AuthenticatedActor,
  MembershipListResponse,
} from '@candidate-compliance/contracts';
import { TenantRole, type PrismaClient } from '@prisma/client';

import { withAuthenticatedActorTransaction } from '../../infrastructure/database/with-authenticated-actor-transaction.js';

interface MembershipOptionRow {
  membership_id: string;
  tenant_id: string;
  tenant_name: string;
  role: TenantRole;
}

export async function listAuthenticatedActorMemberships(
  prisma: PrismaClient,
  actor: AuthenticatedActor,
): Promise<MembershipListResponse> {
  return withAuthenticatedActorTransaction(
    prisma,
    actor,
    async (transaction) => {
      const rows = await transaction.$queryRaw<MembershipOptionRow[]>`
      SELECT membership_id, tenant_id, tenant_name, role
      FROM public.list_current_actor_memberships()
    `;

      return {
        memberships: rows.map((row) => ({
          membershipId: row.membership_id,
          tenantId: row.tenant_id,
          tenantName: row.tenant_name,
          role: row.role,
        })),
      };
    },
  );
}

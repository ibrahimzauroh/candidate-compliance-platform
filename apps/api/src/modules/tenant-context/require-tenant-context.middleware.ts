import { TenantRole, type PrismaClient } from '@prisma/client';
import type { RequestHandler } from 'express';
import { z } from 'zod';

import {
  authenticationRequiredProblem,
  invalidTenantHeaderProblem,
  tenantContextForbiddenProblem,
  tenantHeaderRequiredProblem,
} from '../../infrastructure/http/problem-details.js';

const tenantIdSchema = z.string().trim().pipe(z.uuid());

interface ValidatedMembershipRow {
  membership_id: string;
  tenant_id: string;
  user_id: string;
  role: TenantRole;
}

export function createRequireTenantContextMiddleware(
  prisma: PrismaClient,
): RequestHandler {
  return async (request, _response, next) => {
    const actor = request.authenticatedActor;

    if (!actor) {
      next(authenticationRequiredProblem());
      return;
    }

    const requestedTenantId = request.header('x-tenant-id');

    if (requestedTenantId === undefined) {
      next(tenantHeaderRequiredProblem());
      return;
    }

    const parsedTenantId = tenantIdSchema.safeParse(requestedTenantId);

    if (!parsedTenantId.success) {
      next(invalidTenantHeaderProblem());
      return;
    }

    const memberships = await prisma.$queryRaw<ValidatedMembershipRow[]>`
      SELECT membership_id, tenant_id, user_id, role
      FROM public.validate_tenant_membership(
        ${actor.userId}::uuid,
        ${parsedTenantId.data}::uuid
      )
    `;
    const membership = memberships[0];

    if (
      !membership ||
      membership.user_id !== actor.userId ||
      membership.tenant_id !== parsedTenantId.data
    ) {
      next(tenantContextForbiddenProblem());
      return;
    }

    request.tenantContext = {
      tenantId: membership.tenant_id,
      userId: membership.user_id,
      membershipId: membership.membership_id,
      role: membership.role,
    };
    next();
  };
}

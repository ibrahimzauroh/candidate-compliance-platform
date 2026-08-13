import type { PrismaClient } from '@prisma/client';
import type { RequestHandler } from 'express';
import { z } from 'zod';

import {
  authenticationRequiredProblem,
  invalidTenantHeaderProblem,
  tenantContextForbiddenProblem,
  tenantHeaderRequiredProblem,
} from '../../infrastructure/http/problem-details.js';

const tenantIdSchema = z.string().trim().pipe(z.uuid());

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

    const membership = await prisma.tenantMembership.findUnique({
      where: {
        tenantId_userId: {
          tenantId: parsedTenantId.data,
          userId: actor.userId,
        },
      },
      select: {
        id: true,
        tenantId: true,
        userId: true,
        role: true,
      },
    });

    if (!membership) {
      next(tenantContextForbiddenProblem());
      return;
    }

    request.tenantContext = {
      tenantId: membership.tenantId,
      userId: membership.userId,
      membershipId: membership.id,
      role: membership.role,
    };
    next();
  };
}

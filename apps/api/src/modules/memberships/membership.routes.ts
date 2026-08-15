import { membershipListResponseSchema } from '@candidate-compliance/contracts';
import type { PrismaClient } from '@prisma/client';
import { Router } from 'express';

import type { JwtConfig } from '../../config/jwt-config.js';
import { authenticationRequiredProblem } from '../../infrastructure/http/problem-details.js';
import { createAuthenticationMiddleware } from '../auth/authenticate.middleware.js';
import { listAuthenticatedActorMemberships } from './membership.service.js';

export function createMembershipRouter(
  prisma: PrismaClient,
  jwtConfig: JwtConfig,
): Router {
  const router = Router();

  router.get(
    '/',
    createAuthenticationMiddleware(prisma, jwtConfig),
    async (request, response, next) => {
      const actor = request.authenticatedActor;

      if (!actor) {
        next(authenticationRequiredProblem());
        return;
      }

      const memberships = await listAuthenticatedActorMemberships(
        prisma,
        actor,
      );

      response
        .status(200)
        .json(membershipListResponseSchema.parse(memberships));
    },
  );

  return router;
}

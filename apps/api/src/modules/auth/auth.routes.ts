import {
  loginRequestSchema,
  loginResponseSchema,
  userIdentitySchema,
} from '@candidate-compliance/contracts';
import type { PrismaClient } from '@prisma/client';
import { Router } from 'express';

import type { JwtConfig } from '../../config/jwt-config.js';
import { authenticationRequiredProblem } from '../../infrastructure/http/problem-details.js';
import { authenticateCredentials } from './auth.service.js';
import { createAuthenticationMiddleware } from './authenticate.middleware.js';

export function createAuthRouter(
  prisma: PrismaClient,
  jwtConfig: JwtConfig,
): Router {
  const router = Router();

  router.post('/login', async (request, response) => {
    const input = loginRequestSchema.parse(request.body);
    const result = await authenticateCredentials(prisma, jwtConfig, input);

    response.status(200).json(loginResponseSchema.parse(result));
  });

  router.get(
    '/me',
    createAuthenticationMiddleware(prisma, jwtConfig),
    (request, response, next) => {
      const actor = request.authenticatedActor;

      if (!actor) {
        next(authenticationRequiredProblem());
        return;
      }

      response.status(200).json(
        userIdentitySchema.parse({
          id: actor.userId,
          email: actor.email,
          displayName: actor.displayName,
        }),
      );
    },
  );

  return router;
}

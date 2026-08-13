import type { PrismaClient } from '@prisma/client';
import type { RequestHandler } from 'express';

import type { JwtConfig } from '../../config/jwt-config.js';
import { authenticationRequiredProblem } from '../../infrastructure/http/problem-details.js';
import { findAuthenticatedActor } from './auth.service.js';
import { verifyAccessToken } from './auth-token.js';

export function createAuthenticationMiddleware(
  prisma: PrismaClient,
  jwtConfig: JwtConfig,
): RequestHandler {
  return async (request, _response, next) => {
    const authorization = request.header('authorization');
    const match = authorization?.match(/^Bearer ([^\s]+)$/i);
    const token = match?.[1];

    if (!token) {
      next(authenticationRequiredProblem());
      return;
    }

    try {
      const userId = verifyAccessToken(token, jwtConfig);
      const actor = await findAuthenticatedActor(prisma, userId);

      if (!actor) {
        next(authenticationRequiredProblem());
        return;
      }

      request.authenticatedActor = actor;
      next();
    } catch {
      next(authenticationRequiredProblem());
    }
  };
}

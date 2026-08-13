import { tenantContextSchema } from '@candidate-compliance/contracts';
import type { PrismaClient } from '@prisma/client';
import { Router } from 'express';

import type { JwtConfig } from '../../config/jwt-config.js';
import { authenticationRequiredProblem } from '../../infrastructure/http/problem-details.js';
import { createAuthenticationMiddleware } from '../auth/authenticate.middleware.js';
import { createRequireTenantContextMiddleware } from './require-tenant-context.middleware.js';

export function createTenantContextRouter(
  prisma: PrismaClient,
  jwtConfig: JwtConfig,
): Router {
  const router = Router();

  router.get(
    '/',
    createAuthenticationMiddleware(prisma, jwtConfig),
    createRequireTenantContextMiddleware(prisma),
    (request, response, next) => {
      if (!request.tenantContext) {
        next(authenticationRequiredProblem());
        return;
      }

      response
        .status(200)
        .json(tenantContextSchema.parse(request.tenantContext));
    },
  );

  return router;
}

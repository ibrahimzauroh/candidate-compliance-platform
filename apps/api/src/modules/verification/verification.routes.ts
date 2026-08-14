import {
  documentIdParamsSchema,
  requestVerificationRequestSchema,
  verificationRequestIdParamsSchema,
  verificationRequestSchema,
  type TenantContext,
} from '@candidate-compliance/contracts';
import type { PrismaClient } from '@prisma/client';
import { Router, type Request } from 'express';

import type { JwtConfig } from '../../config/jwt-config.js';
import { permissionForbiddenProblem } from '../../infrastructure/http/problem-details.js';
import { createAuthenticationMiddleware } from '../auth/authenticate.middleware.js';
import { PERMISSIONS } from '../authorisation/permissions.js';
import { requirePermission } from '../authorisation/require-permission.middleware.js';
import { parseIdempotencyKey } from '../idempotency/idempotency.service.js';
import { createRequireTenantContextMiddleware } from '../tenant-context/require-tenant-context.middleware.js';
import {
  getVerificationRequest,
  requestRightToWorkVerification,
} from './verification.service.js';

function tenantContextFrom(request: Request): TenantContext {
  if (!request.tenantContext) {
    throw permissionForbiddenProblem();
  }

  return request.tenantContext;
}

export function createVerificationRouter(
  prisma: PrismaClient,
  jwtConfig: JwtConfig,
): Router {
  const router = Router();
  const authenticate = createAuthenticationMiddleware(prisma, jwtConfig);
  const requireTenantContext = createRequireTenantContextMiddleware(prisma);

  router.post(
    '/documents/:documentId/verifications',
    authenticate,
    requireTenantContext,
    requirePermission(PERMISSIONS.verificationRequest),
    async (request, response) => {
      const { documentId } = documentIdParamsSchema.parse(request.params);
      requestVerificationRequestSchema.parse(request.body ?? {});
      const idempotencyKey = parseIdempotencyKey(
        request.header('idempotency-key'),
      );
      const result = await requestRightToWorkVerification(
        prisma,
        tenantContextFrom(request),
        documentId,
        idempotencyKey,
      );

      response
        .status(result.status)
        .json(verificationRequestSchema.parse(result.body));
    },
  );

  router.get(
    '/verifications/:verificationRequestId',
    authenticate,
    requireTenantContext,
    requirePermission(PERMISSIONS.verificationRead),
    async (request, response) => {
      const { verificationRequestId } = verificationRequestIdParamsSchema.parse(
        request.params,
      );
      const result = await getVerificationRequest(
        prisma,
        tenantContextFrom(request),
        verificationRequestId,
      );

      response.status(200).json(verificationRequestSchema.parse(result));
    },
  );

  return router;
}

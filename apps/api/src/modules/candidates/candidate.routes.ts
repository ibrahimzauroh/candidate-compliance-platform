import {
  candidateIdParamsSchema,
  candidateListQuerySchema,
  candidateListResponseSchema,
  candidateSchema,
  createCandidateRequestSchema,
  noContentResponseSchema,
  updateCandidateRequestSchema,
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
  createCandidate,
  getCandidate,
  listCandidates,
  removeCandidate,
  updateCandidate,
} from './candidate.service.js';

function tenantContextFrom(request: Request): TenantContext {
  if (!request.tenantContext) {
    throw permissionForbiddenProblem();
  }

  return request.tenantContext;
}

export function createCandidateRouter(
  prisma: PrismaClient,
  jwtConfig: JwtConfig,
): Router {
  const router = Router();
  const authenticate = createAuthenticationMiddleware(prisma, jwtConfig);
  const requireTenantContext = createRequireTenantContextMiddleware(prisma);

  router.post(
    '/',
    authenticate,
    requireTenantContext,
    requirePermission(PERMISSIONS.candidateCreate),
    async (request, response) => {
      const input = createCandidateRequestSchema.parse(request.body);
      const idempotencyKey = parseIdempotencyKey(
        request.header('idempotency-key'),
      );
      const result = await createCandidate(
        prisma,
        tenantContextFrom(request),
        input,
        idempotencyKey,
      );

      response.status(result.status).json(candidateSchema.parse(result.body));
    },
  );

  router.get(
    '/',
    authenticate,
    requireTenantContext,
    requirePermission(PERMISSIONS.candidateRead),
    async (request, response) => {
      const query = candidateListQuerySchema.parse(request.query);
      const result = await listCandidates(
        prisma,
        tenantContextFrom(request),
        query,
      );

      response.status(200).json(candidateListResponseSchema.parse(result));
    },
  );

  router.get(
    '/:candidateId',
    authenticate,
    requireTenantContext,
    requirePermission(PERMISSIONS.candidateRead),
    async (request, response) => {
      const { candidateId } = candidateIdParamsSchema.parse(request.params);
      const candidate = await getCandidate(
        prisma,
        tenantContextFrom(request),
        candidateId,
      );

      response.status(200).json(candidateSchema.parse(candidate));
    },
  );

  router.patch(
    '/:candidateId',
    authenticate,
    requireTenantContext,
    requirePermission(PERMISSIONS.candidateUpdate),
    async (request, response) => {
      const { candidateId } = candidateIdParamsSchema.parse(request.params);
      const input = updateCandidateRequestSchema.parse(request.body);
      const idempotencyKey = parseIdempotencyKey(
        request.header('idempotency-key'),
      );
      const result = await updateCandidate(
        prisma,
        tenantContextFrom(request),
        candidateId,
        input,
        idempotencyKey,
      );

      response.status(result.status).json(candidateSchema.parse(result.body));
    },
  );

  router.delete(
    '/:candidateId',
    authenticate,
    requireTenantContext,
    requirePermission(PERMISSIONS.candidateRemove),
    async (request, response) => {
      const { candidateId } = candidateIdParamsSchema.parse(request.params);
      const idempotencyKey = parseIdempotencyKey(
        request.header('idempotency-key'),
      );
      const result = await removeCandidate(
        prisma,
        tenantContextFrom(request),
        candidateId,
        idempotencyKey,
      );

      noContentResponseSchema.parse(result.body);
      response.status(result.status).send();
    },
  );

  return router;
}

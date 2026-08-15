import {
  candidateIdParamsSchema,
  confirmCvExtractionRequestSchema,
  cvExtractionIdParamsSchema,
  cvExtractionSchema,
  rejectCvExtractionRequestSchema,
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
import type { CvExtractionProvider } from './cv-extraction.provider.js';
import {
  confirmCvExtraction,
  createCvExtraction,
  getCvExtraction,
  rejectCvExtraction,
} from './cv-extraction.service.js';
import { parseCvUpload, readCvUpload } from './cv-upload.js';

function tenantContextFrom(request: Request): TenantContext {
  if (!request.tenantContext) {
    throw permissionForbiddenProblem();
  }

  return request.tenantContext;
}

export function createCvExtractionRouter(
  prisma: PrismaClient,
  jwtConfig: JwtConfig,
  provider: CvExtractionProvider,
  now: () => Date = () => new Date(),
): Router {
  const router = Router();
  const authenticate = createAuthenticationMiddleware(prisma, jwtConfig);
  const requireTenantContext = createRequireTenantContextMiddleware(prisma);

  router.post(
    '/candidates/:candidateId/cv-extractions',
    authenticate,
    requireTenantContext,
    requirePermission(PERMISSIONS.aiExtract),
    parseCvUpload,
    async (request, response) => {
      const { candidateId } = candidateIdParamsSchema.parse(request.params);
      const idempotencyKey = parseIdempotencyKey(
        request.header('idempotency-key'),
      );
      const upload = await readCvUpload(request);
      const result = await createCvExtraction(
        prisma,
        tenantContextFrom(request),
        candidateId,
        upload,
        provider,
        idempotencyKey,
      );

      response
        .status(result.status)
        .json(cvExtractionSchema.parse(result.body));
    },
  );

  router.get(
    '/cv-extractions/:extractionId',
    authenticate,
    requireTenantContext,
    requirePermission(PERMISSIONS.aiExtract),
    async (request, response) => {
      const { extractionId } = cvExtractionIdParamsSchema.parse(request.params);
      const extraction = await getCvExtraction(
        prisma,
        tenantContextFrom(request),
        extractionId,
      );

      response.status(200).json(cvExtractionSchema.parse(extraction));
    },
  );

  router.post(
    '/cv-extractions/:extractionId/confirm',
    authenticate,
    requireTenantContext,
    requirePermission(PERMISSIONS.aiConfirm),
    async (request, response) => {
      const { extractionId } = cvExtractionIdParamsSchema.parse(request.params);
      const input = confirmCvExtractionRequestSchema.parse(request.body);
      const idempotencyKey = parseIdempotencyKey(
        request.header('idempotency-key'),
      );
      const result = await confirmCvExtraction(
        prisma,
        tenantContextFrom(request),
        extractionId,
        input,
        idempotencyKey,
        now(),
      );

      response
        .status(result.status)
        .json(cvExtractionSchema.parse(result.body));
    },
  );

  router.post(
    '/cv-extractions/:extractionId/reject',
    authenticate,
    requireTenantContext,
    requirePermission(PERMISSIONS.aiConfirm),
    async (request, response) => {
      const { extractionId } = cvExtractionIdParamsSchema.parse(request.params);
      rejectCvExtractionRequestSchema.parse(request.body ?? {});
      const idempotencyKey = parseIdempotencyKey(
        request.header('idempotency-key'),
      );
      const result = await rejectCvExtraction(
        prisma,
        tenantContextFrom(request),
        extractionId,
        idempotencyKey,
        now(),
      );

      response
        .status(result.status)
        .json(cvExtractionSchema.parse(result.body));
    },
  );

  return router;
}

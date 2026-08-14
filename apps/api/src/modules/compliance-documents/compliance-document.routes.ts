import {
  approveComplianceDocumentRequestSchema,
  candidateDocumentListQuerySchema,
  candidateDocumentListResponseSchema,
  candidateIdParamsSchema,
  complianceDocumentSchema,
  correctComplianceDocumentRequestSchema,
  createComplianceDocumentRequestSchema,
  createComplianceDocumentVersionRequestSchema,
  documentIdParamsSchema,
  expiringComplianceDocumentListQuerySchema,
  expiringComplianceDocumentListResponseSchema,
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
  addComplianceDocumentVersion,
  approveComplianceDocument,
  correctComplianceDocument,
  createComplianceDocument,
  getComplianceDocument,
  listCandidateComplianceDocuments,
  listExpiringComplianceDocuments,
} from './compliance-document.service.js';

function tenantContextFrom(request: Request): TenantContext {
  if (!request.tenantContext) {
    throw permissionForbiddenProblem();
  }

  return request.tenantContext;
}

export function createComplianceDocumentRouter(
  prisma: PrismaClient,
  jwtConfig: JwtConfig,
  now: () => Date = () => new Date(),
): Router {
  const router = Router();
  const authenticate = createAuthenticationMiddleware(prisma, jwtConfig);
  const requireTenantContext = createRequireTenantContextMiddleware(prisma);

  router.post(
    '/candidates/:candidateId/documents',
    authenticate,
    requireTenantContext,
    requirePermission(PERMISSIONS.documentCreate),
    async (request, response) => {
      const { candidateId } = candidateIdParamsSchema.parse(request.params);
      const input = createComplianceDocumentRequestSchema.parse(request.body);
      const idempotencyKey = parseIdempotencyKey(
        request.header('idempotency-key'),
      );
      const result = await createComplianceDocument(
        prisma,
        tenantContextFrom(request),
        candidateId,
        input,
        idempotencyKey,
      );

      response
        .status(result.status)
        .json(complianceDocumentSchema.parse(result.body));
    },
  );

  router.get(
    '/candidates/:candidateId/documents',
    authenticate,
    requireTenantContext,
    requirePermission(PERMISSIONS.documentRead),
    async (request, response) => {
      const { candidateId } = candidateIdParamsSchema.parse(request.params);
      const query = candidateDocumentListQuerySchema.parse(request.query);
      const result = await listCandidateComplianceDocuments(
        prisma,
        tenantContextFrom(request),
        candidateId,
        query,
      );

      response
        .status(200)
        .json(candidateDocumentListResponseSchema.parse(result));
    },
  );

  router.get(
    '/documents/expiring',
    authenticate,
    requireTenantContext,
    requirePermission(PERMISSIONS.documentRead),
    async (request, response) => {
      const query = expiringComplianceDocumentListQuerySchema.parse(
        request.query,
      );
      const result = await listExpiringComplianceDocuments(
        prisma,
        tenantContextFrom(request),
        query,
        now(),
      );

      response
        .status(200)
        .json(expiringComplianceDocumentListResponseSchema.parse(result));
    },
  );

  router.get(
    '/documents/:documentId',
    authenticate,
    requireTenantContext,
    requirePermission(PERMISSIONS.documentRead),
    async (request, response) => {
      const { documentId } = documentIdParamsSchema.parse(request.params);
      const document = await getComplianceDocument(
        prisma,
        tenantContextFrom(request),
        documentId,
      );

      response.status(200).json(complianceDocumentSchema.parse(document));
    },
  );

  router.post(
    '/documents/:documentId/versions',
    authenticate,
    requireTenantContext,
    requirePermission(PERMISSIONS.documentCreate),
    async (request, response) => {
      const { documentId } = documentIdParamsSchema.parse(request.params);
      const input = createComplianceDocumentVersionRequestSchema.parse(
        request.body,
      );
      const idempotencyKey = parseIdempotencyKey(
        request.header('idempotency-key'),
      );
      const result = await addComplianceDocumentVersion(
        prisma,
        tenantContextFrom(request),
        documentId,
        input,
        idempotencyKey,
      );

      response
        .status(result.status)
        .json(complianceDocumentSchema.parse(result.body));
    },
  );

  router.post(
    '/documents/:documentId/approve',
    authenticate,
    requireTenantContext,
    requirePermission(PERMISSIONS.documentApprove),
    async (request, response) => {
      const { documentId } = documentIdParamsSchema.parse(request.params);
      approveComplianceDocumentRequestSchema.parse(request.body ?? {});
      const idempotencyKey = parseIdempotencyKey(
        request.header('idempotency-key'),
      );
      const result = await approveComplianceDocument(
        prisma,
        tenantContextFrom(request),
        documentId,
        idempotencyKey,
      );

      response
        .status(result.status)
        .json(complianceDocumentSchema.parse(result.body));
    },
  );

  router.post(
    '/documents/:documentId/corrections',
    authenticate,
    requireTenantContext,
    requirePermission(PERMISSIONS.documentCorrect),
    async (request, response) => {
      const { documentId } = documentIdParamsSchema.parse(request.params);
      const input = correctComplianceDocumentRequestSchema.parse(request.body);
      const idempotencyKey = parseIdempotencyKey(
        request.header('idempotency-key'),
      );
      const result = await correctComplianceDocument(
        prisma,
        tenantContextFrom(request),
        documentId,
        input,
        idempotencyKey,
      );

      response
        .status(result.status)
        .json(complianceDocumentSchema.parse(result.body));
    },
  );

  return router;
}

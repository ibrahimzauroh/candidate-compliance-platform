import { healthResponseSchema } from '@candidate-compliance/contracts';
import type { PrismaClient } from '@prisma/client';
import express, { type Express } from 'express';

import type { JwtConfig } from './config/jwt-config.js';
import { problemDetailsHandler } from './infrastructure/http/problem-details.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { createCandidateRouter } from './modules/candidates/candidate.routes.js';
import { createComplianceDocumentRouter } from './modules/compliance-documents/compliance-document.routes.js';
import {
  DeterministicLocalCvExtractionProvider,
  type CvExtractionProvider,
} from './modules/cv-extractions/cv-extraction.provider.js';
import { createCvExtractionRouter } from './modules/cv-extractions/cv-extraction.routes.js';
import { createTenantContextRouter } from './modules/tenant-context/tenant-context.routes.js';
import { createVerificationRouter } from './modules/verification/verification.routes.js';

interface AppDependencies {
  prisma: PrismaClient;
  jwtConfig: JwtConfig;
  now?: () => Date;
  cvExtractionProvider?: CvExtractionProvider;
}

export function createApp({
  prisma,
  jwtConfig,
  now,
  cvExtractionProvider = new DeterministicLocalCvExtractionProvider(),
}: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_request, response) => {
    response.status(200).json(healthResponseSchema.parse({ status: 'ok' }));
  });

  app.use('/api/v1/auth', createAuthRouter(prisma, jwtConfig));
  app.use('/api/v1/context', createTenantContextRouter(prisma, jwtConfig));
  app.use('/api/v1/candidates', createCandidateRouter(prisma, jwtConfig));
  app.use('/api/v1', createComplianceDocumentRouter(prisma, jwtConfig, now));
  app.use('/api/v1', createVerificationRouter(prisma, jwtConfig));
  app.use(
    '/api/v1',
    createCvExtractionRouter(prisma, jwtConfig, cvExtractionProvider, now),
  );
  app.use(problemDetailsHandler);

  return app;
}

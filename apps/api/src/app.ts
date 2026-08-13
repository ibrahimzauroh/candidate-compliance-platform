import { healthResponseSchema } from '@candidate-compliance/contracts';
import type { PrismaClient } from '@prisma/client';
import express, { type Express } from 'express';

import type { JwtConfig } from './config/jwt-config.js';
import { problemDetailsHandler } from './infrastructure/http/problem-details.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';

interface AppDependencies {
  prisma: PrismaClient;
  jwtConfig: JwtConfig;
}

export function createApp({ prisma, jwtConfig }: AppDependencies): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_request, response) => {
    response.status(200).json(healthResponseSchema.parse({ status: 'ok' }));
  });

  app.use('/api/v1/auth', createAuthRouter(prisma, jwtConfig));
  app.use(problemDetailsHandler);

  return app;
}

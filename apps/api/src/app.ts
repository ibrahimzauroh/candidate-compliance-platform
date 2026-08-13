import { healthResponseSchema } from '@candidate-compliance/contracts';
import express, { type Express } from 'express';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_request, response) => {
    response.status(200).json(healthResponseSchema.parse({ status: 'ok' }));
  });

  return app;
}

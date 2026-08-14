import { PrismaClient } from '@prisma/client';

import { createApp } from './app.js';
import { readJwtConfig } from './config/jwt-config.js';
import { loadEnvironment } from './config/load-environment.js';

loadEnvironment();

const port = Number.parseInt(process.env.API_PORT ?? '4000', 10);
const prisma = new PrismaClient();
const app = createApp({ prisma, jwtConfig: readJwtConfig() });

const server = app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});

function shutdown(signal: string): void {
  console.log(`${signal} received, closing HTTP server`);
  server.close(async (error) => {
    await prisma.$disconnect();

    if (error) {
      console.error('Failed to close HTTP server', error);
      process.exitCode = 1;
    }
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

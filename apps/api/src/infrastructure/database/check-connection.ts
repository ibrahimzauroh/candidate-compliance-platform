import { PrismaClient } from '@prisma/client';

import { loadEnvironment } from '../../config/load-environment.js';

loadEnvironment();

const prisma = new PrismaClient();

try {
  await prisma.$queryRaw`SELECT 1`;
  console.log('PostgreSQL connection verified');
} finally {
  await prisma.$disconnect();
}

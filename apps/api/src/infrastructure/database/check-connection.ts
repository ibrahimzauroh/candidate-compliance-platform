import { PrismaClient } from '@prisma/client';

import { loadEnvironment } from '../../config/load-environment.js';

loadEnvironment();

const prisma = new PrismaClient();

try {
  const [identity] = await prisma.$queryRaw<Array<{ current_user: string }>>`
    SELECT current_user
  `;
  console.log(`PostgreSQL connection verified as ${identity?.current_user}`);
} finally {
  await prisma.$disconnect();
}

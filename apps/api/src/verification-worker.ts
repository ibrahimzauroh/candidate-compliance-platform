import { PrismaClient } from '@prisma/client';

import { loadEnvironment } from './config/load-environment.js';
import { DeterministicLocalRightToWorkVerifier } from './modules/verification/right-to-work-verifier.js';
import { processNextVerificationEvent } from './modules/verification/verification.processor.js';

loadEnvironment();

const POLL_INTERVAL_MS = 1_000;
const prisma = new PrismaClient();
const verifier = new DeterministicLocalRightToWorkVerifier();
const workerId = `local:${process.pid}`;
let stopping = false;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function run(): Promise<void> {
  while (!stopping) {
    try {
      const result = await processNextVerificationEvent({
        prisma,
        verifier,
        workerId,
      });

      if (result.outcome === 'idle') {
        await delay(POLL_INTERVAL_MS);
      }
    } catch {
      console.error('Verification worker iteration failed');
      await delay(POLL_INTERVAL_MS);
    }
  }

  await prisma.$disconnect();
}

function shutdown(signal: string): void {
  console.log(`${signal} received, stopping verification worker`);
  stopping = true;
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

void run().catch(async () => {
  console.error('Verification worker stopped unexpectedly');
  process.exitCode = 1;
  await prisma.$disconnect();
});

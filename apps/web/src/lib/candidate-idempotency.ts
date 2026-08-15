import type { CreateCandidateRequest } from '@candidate-compliance/contracts';
import { createHmac } from 'node:crypto';

interface CandidateAttempt {
  actorId: string;
  attemptId: string;
  input: CreateCandidateRequest;
  sessionCredential: string;
  tenantId: string;
}

export function deriveCandidateIdempotencyKey({
  actorId,
  attemptId,
  input,
  sessionCredential,
  tenantId,
}: CandidateAttempt): string {
  const fingerprint = createHmac('sha256', sessionCredential)
    .update(
      JSON.stringify({
        actorId,
        attemptId,
        input: {
          email: input.email,
          fullName: input.fullName,
          roleAppliedFor: input.roleAppliedFor,
        },
        tenantId,
      }),
    )
    .digest('hex');

  return `candidate:create:${fingerprint}`;
}

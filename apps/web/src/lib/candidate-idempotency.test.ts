import type { CreateCandidateRequest } from '@candidate-compliance/contracts';
import { describe, expect, it } from 'vitest';

import { deriveCandidateIdempotencyKey } from './candidate-idempotency';

const input: CreateCandidateRequest = {
  fullName: 'Ada Candidate',
  email: 'ada@example.test',
  roleAppliedFor: 'Compliance Engineer',
};

const baseAttempt = {
  actorId: '20000000-0000-4000-8000-000000000001',
  attemptId: '40000000-0000-4000-8000-000000000001',
  input,
  sessionCredential: 'opaque-test-session',
  tenantId: '10000000-0000-4000-8000-000000000001',
};

describe('Candidate create idempotency', () => {
  it('derives a stable bounded key for a safe retry', () => {
    const first = deriveCandidateIdempotencyKey(baseAttempt);
    const retry = deriveCandidateIdempotencyKey({ ...baseAttempt });

    expect(retry).toBe(first);
    expect(first).toMatch(/^candidate:create:[a-f0-9]{64}$/);
    expect(first).not.toContain(baseAttempt.attemptId);
  });

  it('does not reuse a key for a new attempt, payload, actor or tenant', () => {
    const original = deriveCandidateIdempotencyKey(baseAttempt);
    const variants = [
      { ...baseAttempt, attemptId: '40000000-0000-4000-8000-000000000002' },
      { ...baseAttempt, input: { ...input, fullName: 'Grace Candidate' } },
      { ...baseAttempt, actorId: '20000000-0000-4000-8000-000000000002' },
      { ...baseAttempt, sessionCredential: 'another-opaque-test-session' },
      { ...baseAttempt, tenantId: '10000000-0000-4000-8000-000000000002' },
    ];

    expect(
      new Set(
        variants.map((variant) => deriveCandidateIdempotencyKey(variant)),
      ),
    ).not.toContain(original);
  });
});

import { describe, expect, it } from 'vitest';

import { deriveCvIdempotencyKey } from './cv-idempotency';

const base = {
  actorId: '20000000-0000-4000-8000-000000000001',
  attemptId: '30000000-0000-4000-8000-000000000001',
  sessionCredential: 'opaque-session-credential',
  tenantId: '10000000-0000-4000-8000-000000000001',
};
const profile = {
  fullName: 'Ada Candidate',
  skills: ['TypeScript'],
  yearsOfExperience: 6,
  certifications: ['Right to Work'],
};

describe('deriveCvIdempotencyKey', () => {
  const confirmAttempt = {
    ...base,
    extractionId: '50000000-0000-4000-8000-000000000001',
    input: profile,
    operation: 'confirm' as const,
  };

  it('is stable for one logical retry and does not expose browser or session inputs', () => {
    const first = deriveCvIdempotencyKey(confirmAttempt);
    const retry = deriveCvIdempotencyKey({ ...confirmAttempt });

    expect(retry).toBe(first);
    expect(first).toMatch(/^cv:confirm:[a-f0-9]{64}$/);
    expect(first).not.toContain(base.attemptId);
    expect(first).not.toContain(base.sessionCredential);
  });

  it.each([
    ['attempt', { attemptId: '30000000-0000-4000-8000-000000000002' }],
    ['actor', { actorId: '20000000-0000-4000-8000-000000000002' }],
    ['tenant', { tenantId: '10000000-0000-4000-8000-000000000002' }],
    ['session', { sessionCredential: 'different-session' }],
    ['extraction', { extractionId: '50000000-0000-4000-8000-000000000002' }],
    ['payload', { input: { ...profile, yearsOfExperience: 7 } }],
    ['operation', { operation: 'reject' as const, input: undefined }],
  ])('changes when the %s context changes', (_label, change) => {
    expect(deriveCvIdempotencyKey({ ...confirmAttempt, ...change })).not.toBe(
      deriveCvIdempotencyKey(confirmAttempt),
    );
  });

  it('binds uploads to the Candidate, exact media type and content hash', () => {
    const upload = {
      ...base,
      candidateId: '40000000-0000-4000-8000-000000000001',
      contentHash: 'a'.repeat(64),
      mediaType: 'text/plain' as const,
      operation: 'extract' as const,
    };
    const original = deriveCvIdempotencyKey(upload);

    expect(original).toMatch(/^cv:extract:[a-f0-9]{64}$/);
    expect(
      deriveCvIdempotencyKey({ ...upload, contentHash: 'b'.repeat(64) }),
    ).not.toBe(original);
    expect(
      deriveCvIdempotencyKey({ ...upload, mediaType: 'application/pdf' }),
    ).not.toBe(original);
    expect(
      deriveCvIdempotencyKey({
        ...upload,
        candidateId: '40000000-0000-4000-8000-000000000002',
      }),
    ).not.toBe(original);
  });
});

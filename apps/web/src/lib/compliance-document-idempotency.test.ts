import { describe, expect, it } from 'vitest';

import { deriveComplianceDocumentIdempotencyKey } from './compliance-document-idempotency';

const attempt = {
  actorId: '20000000-0000-4000-8000-000000000001',
  attemptId: '30000000-0000-4000-8000-000000000001',
  candidateId: '40000000-0000-4000-8000-000000000001',
  input: {
    type: 'RIGHT_TO_WORK' as const,
    issueDate: '2026-08-01',
    expiryDate: '2027-08-01',
  },
  sessionCredential: 'opaque-session-credential',
  tenantId: '10000000-0000-4000-8000-000000000001',
};

describe('deriveComplianceDocumentIdempotencyKey', () => {
  it('is stable for the same logical document submission without exposing the attempt', () => {
    const first = deriveComplianceDocumentIdempotencyKey(attempt);
    const replay = deriveComplianceDocumentIdempotencyKey(attempt);

    expect(replay).toBe(first);
    expect(first).toMatch(/^document:create:[a-f0-9]{64}$/);
    expect(first).not.toContain(attempt.attemptId);
    expect(first).not.toContain(attempt.sessionCredential);
  });

  it.each([
    ['attempt', { attemptId: '30000000-0000-4000-8000-000000000002' }],
    ['candidate', { candidateId: '40000000-0000-4000-8000-000000000002' }],
    ['tenant', { tenantId: '10000000-0000-4000-8000-000000000002' }],
    ['payload', { input: { ...attempt.input, type: 'OTHER' as const } }],
  ])('changes when the %s changes', (_label, change) => {
    expect(
      deriveComplianceDocumentIdempotencyKey({ ...attempt, ...change }),
    ).not.toBe(deriveComplianceDocumentIdempotencyKey(attempt));
  });
});

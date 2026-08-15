import { describe, expect, it } from 'vitest';

import {
  deriveComplianceDocumentIdempotencyKey,
  deriveComplianceDocumentLifecycleIdempotencyKey,
} from './compliance-document-idempotency';

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

describe('deriveComplianceDocumentLifecycleIdempotencyKey', () => {
  const lifecycleAttempt = {
    actorId: attempt.actorId,
    attemptId: attempt.attemptId,
    documentId: '50000000-0000-4000-8000-000000000001',
    input: {
      issueDate: '2026-09-01',
      expiryDate: '2027-09-01',
    },
    operation: 'correct' as const,
    sessionCredential: attempt.sessionCredential,
    tenantId: attempt.tenantId,
  };

  it('is stable for one lifecycle retry and hides browser/session inputs', () => {
    const first =
      deriveComplianceDocumentLifecycleIdempotencyKey(lifecycleAttempt);
    const retry = deriveComplianceDocumentLifecycleIdempotencyKey({
      ...lifecycleAttempt,
    });

    expect(retry).toBe(first);
    expect(first).toMatch(/^document:correct:[a-f0-9]{64}$/);
    expect(first).not.toContain(lifecycleAttempt.attemptId);
    expect(first).not.toContain(lifecycleAttempt.sessionCredential);
  });

  it.each([
    ['attempt', { attemptId: '30000000-0000-4000-8000-000000000002' }],
    ['document', { documentId: '50000000-0000-4000-8000-000000000002' }],
    ['tenant', { tenantId: '10000000-0000-4000-8000-000000000002' }],
    ['actor', { actorId: '20000000-0000-4000-8000-000000000002' }],
    ['session', { sessionCredential: 'different-session-credential' }],
    ['operation', { operation: 'approve' as const, input: undefined }],
    [
      'payload',
      {
        input: {
          ...lifecycleAttempt.input,
          expiryDate: '2028-09-01',
        },
      },
    ],
  ])('changes when the %s context changes', (_label, change) => {
    expect(
      deriveComplianceDocumentLifecycleIdempotencyKey({
        ...lifecycleAttempt,
        ...change,
      }),
    ).not.toBe(
      deriveComplianceDocumentLifecycleIdempotencyKey(lifecycleAttempt),
    );
  });
});

import type { CreateComplianceDocumentRequest } from '@candidate-compliance/contracts';
import { createHmac } from 'node:crypto';

interface ComplianceDocumentAttempt {
  actorId: string;
  attemptId: string;
  candidateId: string;
  input: CreateComplianceDocumentRequest;
  sessionCredential: string;
  tenantId: string;
}

export function deriveComplianceDocumentIdempotencyKey({
  actorId,
  attemptId,
  candidateId,
  input,
  sessionCredential,
  tenantId,
}: ComplianceDocumentAttempt): string {
  const fingerprint = createHmac('sha256', sessionCredential)
    .update(
      JSON.stringify({
        actorId,
        attemptId,
        candidateId,
        input: {
          expiryDate: input.expiryDate ?? null,
          issueDate: input.issueDate ?? null,
          type: input.type,
        },
        tenantId,
      }),
    )
    .digest('hex');

  return `document:create:${fingerprint}`;
}

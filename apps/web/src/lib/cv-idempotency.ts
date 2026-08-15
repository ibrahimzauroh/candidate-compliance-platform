import type { ConfirmCvExtractionRequest } from '@candidate-compliance/contracts';
import { createHmac } from 'node:crypto';

interface CvAttemptBase {
  actorId: string;
  attemptId: string;
  sessionCredential: string;
  tenantId: string;
}

type CvAttempt =
  | (CvAttemptBase & {
      candidateId: string;
      contentHash: string;
      mediaType: 'application/pdf' | 'text/plain';
      operation: 'extract';
    })
  | (CvAttemptBase & {
      extractionId: string;
      input: ConfirmCvExtractionRequest;
      operation: 'confirm';
    })
  | (CvAttemptBase & {
      extractionId: string;
      operation: 'reject';
    });

export function deriveCvIdempotencyKey(attempt: CvAttempt): string {
  const operationInput =
    attempt.operation === 'extract'
      ? {
          candidateId: attempt.candidateId,
          contentHash: attempt.contentHash,
          mediaType: attempt.mediaType,
        }
      : attempt.operation === 'confirm'
        ? { extractionId: attempt.extractionId, input: attempt.input }
        : { extractionId: attempt.extractionId };
  const fingerprint = createHmac('sha256', attempt.sessionCredential)
    .update(
      JSON.stringify({
        actorId: attempt.actorId,
        attemptId: attempt.attemptId,
        operation: attempt.operation,
        operationInput,
        tenantId: attempt.tenantId,
      }),
    )
    .digest('hex');

  return `cv:${attempt.operation}:${fingerprint}`;
}

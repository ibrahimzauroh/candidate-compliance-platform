export interface RightToWorkVerificationInput {
  verificationRequestId: string;
  documentVersionId: string;
  expiryDate: Date | null;
}

export type RightToWorkVerificationResult =
  { outcome: 'verified' } | { outcome: 'failed'; failureCode: string };

export interface RightToWorkVerifier {
  verify(
    input: RightToWorkVerificationInput,
  ): Promise<RightToWorkVerificationResult>;
}

export const LOCAL_VERIFIER_FAILURE_CODES = {
  missingExpiry: 'MOCK_EXPIRY_MISSING',
  expired: 'MOCK_DOCUMENT_EXPIRED',
} as const;

function utcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export class DeterministicLocalRightToWorkVerifier implements RightToWorkVerifier {
  constructor(private readonly now: () => Date = () => new Date()) {}

  async verify(
    input: RightToWorkVerificationInput,
  ): Promise<RightToWorkVerificationResult> {
    if (!input.expiryDate) {
      return {
        outcome: 'failed',
        failureCode: LOCAL_VERIFIER_FAILURE_CODES.missingExpiry,
      };
    }

    if (utcDate(input.expiryDate) < utcDate(this.now())) {
      return {
        outcome: 'failed',
        failureCode: LOCAL_VERIFIER_FAILURE_CODES.expired,
      };
    }

    return { outcome: 'verified' };
  }
}

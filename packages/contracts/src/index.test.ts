import { describe, expect, it } from 'vitest';

import {
  candidateDocumentListQuerySchema,
  candidateDocumentListResponseSchema,
  candidateListQuerySchema,
  candidateListResponseSchema,
  complianceDocumentSchema,
  createComplianceDocumentRequestSchema,
  createComplianceDocumentVersionRequestSchema,
  createCandidateRequestSchema,
  expiringComplianceDocumentListQuerySchema,
  expiringComplianceDocumentListResponseSchema,
  healthResponseSchema,
  idempotencyKeySchema,
  loginRequestSchema,
  problemDetailsSchema,
  tenantContextSchema,
  updateCandidateRequestSchema,
} from './index.js';

describe('idempotencyKeySchema', () => {
  it('trims and accepts bounded opaque keys', () => {
    expect(idempotencyKeySchema.parse(' request_01:/retry+2 ')).toBe(
      'request_01:/retry+2',
    );
  });

  it('rejects blank, oversized, or unsafe keys', () => {
    expect(() => idempotencyKeySchema.parse('   ')).toThrow();
    expect(() => idempotencyKeySchema.parse('a'.repeat(201))).toThrow();
    expect(() => idempotencyKeySchema.parse('contains a space')).toThrow();
  });
});

describe('healthResponseSchema', () => {
  it('accepts the API health response', () => {
    expect(healthResponseSchema.parse({ status: 'ok' })).toEqual({
      status: 'ok',
    });
  });

  it('rejects unsupported states', () => {
    expect(() => healthResponseSchema.parse({ status: 'unhealthy' })).toThrow();
  });
});

describe('loginRequestSchema', () => {
  it('trims a valid email without changing its case', () => {
    expect(
      loginRequestSchema.parse({
        email: '  Admin@IZA.com  ',
        password: 'historical-password',
      }),
    ).toEqual({
      email: 'Admin@IZA.com',
      password: 'historical-password',
    });
  });

  it('rejects an invalid email and empty password', () => {
    expect(() =>
      loginRequestSchema.parse({ email: 'not-an-email', password: '' }),
    ).toThrow();
  });
});

describe('problemDetailsSchema', () => {
  it('accepts an RFC 9457-style authentication problem', () => {
    expect(
      problemDetailsSchema.parse({
        type: 'about:blank',
        title: 'Unauthorized',
        status: 401,
        detail: 'Invalid email or password.',
      }),
    ).toEqual({
      type: 'about:blank',
      title: 'Unauthorized',
      status: 401,
      detail: 'Invalid email or password.',
    });
  });
});

describe('tenantContextSchema', () => {
  it('accepts a validated tenant membership context', () => {
    expect(
      tenantContextSchema.parse({
        tenantId: '10000000-0000-4000-8000-000000000001',
        userId: '20000000-0000-4000-8000-000000000004',
        membershipId: '30000000-0000-4000-8000-000000000004',
        role: 'VIEWER',
      }),
    ).toEqual({
      tenantId: '10000000-0000-4000-8000-000000000001',
      userId: '20000000-0000-4000-8000-000000000004',
      membershipId: '30000000-0000-4000-8000-000000000004',
      role: 'VIEWER',
    });
  });

  it('rejects an unsupported tenant role', () => {
    expect(() =>
      tenantContextSchema.parse({
        tenantId: '10000000-0000-4000-8000-000000000001',
        userId: '20000000-0000-4000-8000-000000000004',
        membershipId: '30000000-0000-4000-8000-000000000004',
        role: 'OWNER',
      }),
    ).toThrow();
  });
});

describe('candidate request schemas', () => {
  it('normalises candidate create input', () => {
    expect(
      createCandidateRequestSchema.parse({
        fullName: '  Alex Candidate  ',
        email: '  Alex.Candidate@IZA.com  ',
        roleAppliedFor: '  Software Engineer  ',
      }),
    ).toEqual({
      fullName: 'Alex Candidate',
      email: 'alex.candidate@iza.com',
      roleAppliedFor: 'Software Engineer',
    });
  });

  it('rejects client-controlled tenant ownership', () => {
    expect(() =>
      createCandidateRequestSchema.parse({
        fullName: 'Alex Candidate',
        email: 'alex.candidate@iza.com',
        roleAppliedFor: 'Software Engineer',
        tenantId: '10000000-0000-4000-8000-000000000002',
      }),
    ).toThrow();
  });

  it('requires at least one supported candidate update field', () => {
    expect(() => updateCandidateRequestSchema.parse({})).toThrow();
    expect(() =>
      updateCandidateRequestSchema.parse({
        tenantId: '10000000-0000-4000-8000-000000000002',
      }),
    ).toThrow();
  });
});

describe('candidate list contracts', () => {
  it('applies bounded pagination defaults and normalises filters', () => {
    expect(
      candidateListQuerySchema.parse({
        email: '  Candidate@IZA.com ',
        roleAppliedFor: '  Engineer ',
      }),
    ).toEqual({
      page: 1,
      pageSize: 20,
      email: 'candidate@iza.com',
      roleAppliedFor: 'Engineer',
    });

    expect(() =>
      candidateListQuerySchema.parse({ page: '1', pageSize: '101' }),
    ).toThrow();
  });

  it('accepts a paginated candidate response without tenant ownership fields', () => {
    expect(
      candidateListResponseSchema.parse({
        items: [
          {
            id: '40000000-0000-4000-8000-000000000001',
            fullName: 'Alex Candidate',
            email: 'alex.candidate@iza.com',
            roleAppliedFor: 'Software Engineer',
            createdAt: '2026-08-14T00:00:00.000Z',
            updatedAt: '2026-08-14T00:00:00.000Z',
          },
        ],
        pagination: {
          page: 1,
          pageSize: 20,
          totalItems: 1,
          totalPages: 1,
        },
      }).items[0],
    ).not.toHaveProperty('tenantId');
  });
});

describe('compliance document request schemas', () => {
  it('accepts ISO dates and preserves optional document dates', () => {
    expect(
      createComplianceDocumentRequestSchema.parse({
        type: 'RIGHT_TO_WORK',
        issueDate: '2026-08-01',
        expiryDate: '2027-08-01',
      }),
    ).toEqual({
      type: 'RIGHT_TO_WORK',
      issueDate: '2026-08-01',
      expiryDate: '2027-08-01',
    });

    expect(createComplianceDocumentVersionRequestSchema.parse({})).toEqual({});
  });

  it('rejects invalid date order and client-controlled provenance', () => {
    expect(() =>
      createComplianceDocumentRequestSchema.parse({
        type: 'RIGHT_TO_WORK',
        issueDate: '2027-08-01',
        expiryDate: '2026-08-01',
      }),
    ).toThrow();

    for (const field of [
      'tenantId',
      'candidateId',
      'documentId',
      'versionNumber',
      'currentVersionId',
      'createdBy',
      'supersedesVersionId',
      'status',
    ]) {
      expect(() =>
        createComplianceDocumentRequestSchema.parse({
          type: 'OTHER',
          [field]: 'client-controlled',
        }),
      ).toThrow();
    }
  });
});

describe('compliance document response contracts', () => {
  const document = {
    id: '50000000-0000-4000-8000-000000000001',
    candidateId: '40000000-0000-4000-8000-000000000001',
    type: 'RIGHT_TO_WORK',
    currentVersion: {
      id: '60000000-0000-4000-8000-000000000001',
      versionNumber: 1,
      issueDate: '2026-08-01',
      expiryDate: '2027-08-01',
      status: 'DRAFT',
      createdAt: '2026-08-14T00:00:00.000Z',
    },
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
  } as const;

  it('omits tenant and creator fields from the public document DTO', () => {
    const parsed = complianceDocumentSchema.parse(document);

    expect(parsed).not.toHaveProperty('tenantId');
    expect(parsed.currentVersion).not.toHaveProperty('createdBy');
  });

  it('validates list filters, pagination, and response metadata', () => {
    expect(
      candidateDocumentListQuerySchema.parse({
        type: 'RIGHT_TO_WORK',
        status: 'DRAFT',
      }),
    ).toEqual({
      page: 1,
      pageSize: 20,
      type: 'RIGHT_TO_WORK',
      status: 'DRAFT',
    });
    expect(() =>
      candidateDocumentListQuerySchema.parse({ pageSize: '101' }),
    ).toThrow();

    expect(
      candidateDocumentListResponseSchema.parse({
        items: [document],
        pagination: {
          page: 1,
          pageSize: 20,
          totalItems: 1,
          totalPages: 1,
        },
      }).items,
    ).toHaveLength(1);
  });
});

describe('expiring compliance document contracts', () => {
  it('reuses bounded document pagination and current-version filters', () => {
    expect(
      expiringComplianceDocumentListQuerySchema.parse({
        page: '2',
        pageSize: '10',
        type: 'RIGHT_TO_WORK',
        status: 'DRAFT',
      }),
    ).toEqual({
      page: 2,
      pageSize: 10,
      type: 'RIGHT_TO_WORK',
      status: 'DRAFT',
    });

    expect(() =>
      expiringComplianceDocumentListQuerySchema.parse({ pageSize: '101' }),
    ).toThrow();
  });

  it('uses the existing public document pagination envelope', () => {
    expect(
      expiringComplianceDocumentListResponseSchema.parse({
        items: [],
        pagination: {
          page: 1,
          pageSize: 20,
          totalItems: 0,
          totalPages: 0,
        },
      }),
    ).toEqual({
      items: [],
      pagination: {
        page: 1,
        pageSize: 20,
        totalItems: 0,
        totalPages: 0,
      },
    });
  });
});

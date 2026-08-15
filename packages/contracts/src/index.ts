import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const authenticatedActorSchema = z.object({
  userId: z.uuid(),
  email: z.email(),
  displayName: z.string(),
});

export type AuthenticatedActor = z.infer<typeof authenticatedActorSchema>;

export const tenantRoleSchema = z.enum([
  'ADMIN',
  'RECRUITER',
  'COMPLIANCE_OFFICER',
  'VIEWER',
]);

export const tenantContextSchema = z.object({
  tenantId: z.uuid(),
  userId: z.uuid(),
  membershipId: z.uuid(),
  role: tenantRoleSchema,
});

export type TenantContext = z.infer<typeof tenantContextSchema>;

export const loginRequestSchema = z.strictObject({
  email: z.string().trim().pipe(z.email()).pipe(z.string().max(254)),
  password: z.string().min(1).max(1024),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const userIdentitySchema = z.object({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string(),
});

export type UserIdentity = z.infer<typeof userIdentitySchema>;

export const loginResponseSchema = z.object({
  accessToken: z.string().min(1),
  tokenType: z.literal('Bearer'),
  user: userIdentitySchema,
});

export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const membershipOptionSchema = z.strictObject({
  membershipId: z.uuid(),
  tenantId: z.uuid(),
  tenantName: z.string(),
  role: tenantRoleSchema,
});

export type MembershipOption = z.infer<typeof membershipOptionSchema>;

export const membershipListResponseSchema = z.strictObject({
  memberships: z.array(membershipOptionSchema),
});

export type MembershipListResponse = z.infer<
  typeof membershipListResponseSchema
>;

const candidateFullNameSchema = z.string().trim().min(1).max(200);
const candidateEmailSchema = z
  .string()
  .trim()
  .pipe(z.email())
  .pipe(z.string().max(254))
  .transform((email) => email.toLowerCase());
const candidateRoleAppliedForSchema = z.string().trim().min(1).max(200);

export const createCandidateRequestSchema = z.strictObject({
  fullName: candidateFullNameSchema,
  email: candidateEmailSchema,
  roleAppliedFor: candidateRoleAppliedForSchema,
});

export type CreateCandidateRequest = z.infer<
  typeof createCandidateRequestSchema
>;

export const updateCandidateRequestSchema = z
  .strictObject({
    fullName: candidateFullNameSchema.optional(),
    email: candidateEmailSchema.optional(),
    roleAppliedFor: candidateRoleAppliedForSchema.optional(),
  })
  .refine(
    (input) => Object.values(input).some((value) => value !== undefined),
    {
      message: 'At least one candidate field must be provided.',
    },
  );

export type UpdateCandidateRequest = z.infer<
  typeof updateCandidateRequestSchema
>;

export const candidateIdParamsSchema = z.strictObject({
  candidateId: z.uuid(),
});

export const candidateListQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).max(200).optional(),
  email: candidateEmailSchema.optional(),
  roleAppliedFor: candidateRoleAppliedForSchema.optional(),
});

export type CandidateListQuery = z.infer<typeof candidateListQuerySchema>;

export const candidateSchema = z.strictObject({
  id: z.uuid(),
  fullName: z.string(),
  email: z.email(),
  roleAppliedFor: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type Candidate = z.infer<typeof candidateSchema>;

export const candidateListResponseSchema = z.strictObject({
  items: z.array(candidateSchema),
  pagination: z.strictObject({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }),
});

export type CandidateListResponse = z.infer<typeof candidateListResponseSchema>;

export const noContentResponseSchema = z.strictObject({});

export type NoContentResponse = z.infer<typeof noContentResponseSchema>;

export const complianceDocumentTypeSchema = z.enum([
  'RIGHT_TO_WORK',
  'BACKGROUND_CHECK',
  'PROFESSIONAL_CERTIFICATION',
  'OTHER',
]);

export const complianceDocumentStatusSchema = z.enum([
  'DRAFT',
  'PENDING_REVIEW',
  'APPROVED',
  'REJECTED',
]);

const complianceDocumentDateFields = {
  issueDate: z.iso.date().nullable().optional(),
  expiryDate: z.iso.date().nullable().optional(),
} as const;

function hasValidDocumentDateOrder(input: {
  issueDate?: string | null;
  expiryDate?: string | null;
}): boolean {
  return (
    !input.issueDate || !input.expiryDate || input.expiryDate >= input.issueDate
  );
}

export const createComplianceDocumentRequestSchema = z
  .strictObject({
    type: complianceDocumentTypeSchema,
    ...complianceDocumentDateFields,
  })
  .refine(hasValidDocumentDateOrder, {
    path: ['expiryDate'],
    message: 'Expiry date must not be earlier than issue date.',
  });

export type CreateComplianceDocumentRequest = z.infer<
  typeof createComplianceDocumentRequestSchema
>;

export const createComplianceDocumentVersionRequestSchema = z
  .strictObject(complianceDocumentDateFields)
  .refine(hasValidDocumentDateOrder, {
    path: ['expiryDate'],
    message: 'Expiry date must not be earlier than issue date.',
  });

export type CreateComplianceDocumentVersionRequest = z.infer<
  typeof createComplianceDocumentVersionRequestSchema
>;

export const approveComplianceDocumentRequestSchema = z.strictObject({});

export const correctComplianceDocumentRequestSchema = z
  .strictObject({
    issueDate: z.iso.date().nullable(),
    expiryDate: z.iso.date().nullable(),
  })
  .refine(hasValidDocumentDateOrder, {
    path: ['expiryDate'],
    message: 'Expiry date must not be earlier than issue date.',
  });

export type CorrectComplianceDocumentRequest = z.infer<
  typeof correctComplianceDocumentRequestSchema
>;

export const documentIdParamsSchema = z.strictObject({
  documentId: z.uuid(),
});

export const candidateDocumentListQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  type: complianceDocumentTypeSchema.optional(),
  status: complianceDocumentStatusSchema.optional(),
});

export type CandidateDocumentListQuery = z.infer<
  typeof candidateDocumentListQuerySchema
>;

export const complianceDocumentVersionSchema = z.strictObject({
  id: z.uuid(),
  versionNumber: z.number().int().positive(),
  issueDate: z.iso.date().nullable(),
  expiryDate: z.iso.date().nullable(),
  status: complianceDocumentStatusSchema,
  createdAt: z.iso.datetime(),
});

export type ComplianceDocumentVersion = z.infer<
  typeof complianceDocumentVersionSchema
>;

export const complianceDocumentVersionHistoryItemSchema =
  complianceDocumentVersionSchema.extend({
    isCurrent: z.boolean(),
  });

export type ComplianceDocumentVersionHistoryItem = z.infer<
  typeof complianceDocumentVersionHistoryItemSchema
>;

export const complianceDocumentVersionHistoryResponseSchema = z
  .strictObject({
    items: z.array(complianceDocumentVersionHistoryItemSchema).min(1),
  })
  .refine(
    ({ items }) => items.filter((version) => version.isCurrent).length === 1,
    {
      path: ['items'],
      message: 'Version history must identify exactly one current version.',
    },
  );

export type ComplianceDocumentVersionHistoryResponse = z.infer<
  typeof complianceDocumentVersionHistoryResponseSchema
>;

export const complianceDocumentSchema = z.strictObject({
  id: z.uuid(),
  candidateId: z.uuid(),
  type: complianceDocumentTypeSchema,
  currentVersion: complianceDocumentVersionSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type ComplianceDocument = z.infer<typeof complianceDocumentSchema>;

export const candidateDocumentListResponseSchema = z.strictObject({
  items: z.array(complianceDocumentSchema),
  pagination: z.strictObject({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }),
});

export type CandidateDocumentListResponse = z.infer<
  typeof candidateDocumentListResponseSchema
>;

export const expiringComplianceDocumentListQuerySchema =
  candidateDocumentListQuerySchema;

export type ExpiringComplianceDocumentListQuery = z.infer<
  typeof expiringComplianceDocumentListQuerySchema
>;

export const expiringComplianceDocumentListResponseSchema =
  candidateDocumentListResponseSchema;

export type ExpiringComplianceDocumentListResponse = z.infer<
  typeof expiringComplianceDocumentListResponseSchema
>;

export const requestVerificationRequestSchema = z.strictObject({});

export const verificationRequestIdParamsSchema = z.strictObject({
  verificationRequestId: z.uuid(),
});

export const verificationStatusSchema = z.enum([
  'requested',
  'pending',
  'verified',
  'failed',
]);

export const verificationRequestSchema = z.strictObject({
  id: z.uuid(),
  documentId: z.uuid(),
  documentVersionId: z.uuid(),
  status: verificationStatusSchema,
  attemptCount: z.number().int().min(0).max(3),
  failureCode: z
    .string()
    .regex(/^[A-Z0-9_]{1,64}$/)
    .nullable(),
  requestedAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
});

export type VerificationRequest = z.infer<typeof verificationRequestSchema>;

function normalisedUniqueList(itemMaxLength: number) {
  return z
    .array(z.string().trim().min(1).max(itemMaxLength))
    .max(50)
    .transform((values) => {
      const seen = new Set<string>();

      return values.filter((value) => {
        const normalised = value.toLowerCase();

        if (seen.has(normalised)) {
          return false;
        }

        seen.add(normalised);
        return true;
      });
    });
}

export const cvProfileSchema = z.strictObject({
  fullName: z.string().trim().min(1).max(200),
  skills: normalisedUniqueList(100),
  yearsOfExperience: z.number().int().min(0).max(80),
  certifications: normalisedUniqueList(200),
});

export type CvProfile = z.infer<typeof cvProfileSchema>;

export const cvExtractionIdParamsSchema = z.strictObject({
  extractionId: z.uuid(),
});

export const confirmCvExtractionRequestSchema = cvProfileSchema;
export type ConfirmCvExtractionRequest = z.infer<
  typeof confirmCvExtractionRequestSchema
>;

export const rejectCvExtractionRequestSchema = z.strictObject({});

export const cvExtractionStatusSchema = z.enum([
  'PROPOSED',
  'ACCEPTED',
  'REJECTED',
]);

export const cvExtractionSchema = z.strictObject({
  id: z.uuid(),
  candidateId: z.uuid(),
  purpose: z.literal('CANDIDATE_PROFILE'),
  provider: z.string().min(1).max(100),
  model: z.string().min(1).max(100),
  status: cvExtractionStatusSchema,
  proposedOutput: cvProfileSchema,
  confirmedOutput: cvProfileSchema.nullable(),
  createdAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
});

export type CvExtraction = z.infer<typeof cvExtractionSchema>;

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._~:/+-]+$/);

export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string(),
  errors: z
    .array(
      z.object({
        path: z.string(),
        message: z.string(),
      }),
    )
    .optional(),
});

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

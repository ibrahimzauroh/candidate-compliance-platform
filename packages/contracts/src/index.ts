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

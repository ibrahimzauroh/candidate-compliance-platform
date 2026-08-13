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

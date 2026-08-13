import type { SignOptions } from 'jsonwebtoken';
import { z } from 'zod';

const jwtEnvironmentSchema = z.object({
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().regex(/^\d+[smhd]$/),
});

export interface JwtConfig {
  secret: string;
  expiresIn: SignOptions['expiresIn'];
}

export function readJwtConfig(
  environment: NodeJS.ProcessEnv = process.env,
): JwtConfig {
  const parsed = jwtEnvironmentSchema.parse(environment);

  return {
    secret: parsed.JWT_SECRET,
    expiresIn: parsed.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  };
}

import type {
  AuthenticatedActor,
  LoginRequest,
  LoginResponse,
} from '@candidate-compliance/contracts';
import type { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

import type { JwtConfig } from '../../config/jwt-config.js';
import { invalidCredentialsProblem } from '../../infrastructure/http/problem-details.js';
import { issueAccessToken } from './auth-token.js';

const UNKNOWN_USER_PASSWORD_HASH =
  '$2b$10$aosd9c3LWJlEqjeBLYUBAOvG4VP/2ezNWa1e2Hqcu3NRPpXbGeawG';

const userIdentitySelect = {
  id: true,
  email: true,
  displayName: true,
} as const;

export async function authenticateCredentials(
  prisma: PrismaClient,
  jwtConfig: JwtConfig,
  input: LoginRequest,
): Promise<LoginResponse> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: {
      ...userIdentitySelect,
      passwordHash: true,
    },
  });

  const passwordMatches = await bcrypt.compare(
    input.password,
    user?.passwordHash ?? UNKNOWN_USER_PASSWORD_HASH,
  );

  if (!user || !passwordMatches) {
    throw invalidCredentialsProblem();
  }

  return {
    accessToken: issueAccessToken(user.id, jwtConfig),
    tokenType: 'Bearer',
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    },
  };
}

export async function findAuthenticatedActor(
  prisma: PrismaClient,
  userId: string,
): Promise<AuthenticatedActor | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: userIdentitySelect,
  });

  if (!user) {
    return null;
  }

  return {
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
  };
}

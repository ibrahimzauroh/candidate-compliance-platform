import type { ProblemDetails } from '@candidate-compliance/contracts';
import { NextResponse } from 'next/server';

import { problemResponse } from './server-api';
import {
  expiredCookieOptions,
  SESSION_COOKIE_NAME,
  TENANT_COOKIE_NAME,
} from './session-cookies';

export function jsonProblem(problem: ProblemDetails): NextResponse {
  return NextResponse.json(problem, {
    status: problem.status,
    headers: { 'Content-Type': 'application/problem+json' },
  });
}

export function requestErrorResponse(error: unknown): NextResponse {
  const { problem } = problemResponse(error);
  const response = jsonProblem(problem);

  if (problem.status === 401) {
    clearSessionCookies(response);
  }

  return response;
}

export function clearSessionCookies(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE_NAME, '', expiredCookieOptions);
  response.cookies.set(TENANT_COOKIE_NAME, '', expiredCookieOptions);
}

export const sameOriginProblem: ProblemDetails = {
  type: 'about:blank',
  title: 'Forbidden',
  status: 403,
  detail: 'The request origin could not be verified.',
};

export const authenticationRequiredProblem: ProblemDetails = {
  type: 'about:blank',
  title: 'Unauthorized',
  status: 401,
  detail: 'Your session is no longer valid. Please sign in again.',
};

export const invalidFrontendRequestProblem: ProblemDetails = {
  type: 'about:blank',
  title: 'Bad Request',
  status: 400,
  detail: 'The request data is invalid.',
};

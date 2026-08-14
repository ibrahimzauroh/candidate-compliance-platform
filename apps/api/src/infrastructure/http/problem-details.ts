import {
  problemDetailsSchema,
  type ProblemDetails,
} from '@candidate-compliance/contracts';
import type { ErrorRequestHandler, Response } from 'express';
import { z } from 'zod';

export class ProblemError extends Error {
  constructor(public readonly problem: ProblemDetails) {
    super(problem.detail);
  }
}

export function invalidCredentialsProblem(): ProblemError {
  return new ProblemError({
    type: 'about:blank',
    title: 'Unauthorized',
    status: 401,
    detail: 'Invalid email or password.',
  });
}

export function authenticationRequiredProblem(): ProblemError {
  return new ProblemError({
    type: 'about:blank',
    title: 'Unauthorized',
    status: 401,
    detail: 'A valid Bearer access token is required.',
  });
}

export function tenantHeaderRequiredProblem(): ProblemError {
  return new ProblemError({
    type: 'about:blank',
    title: 'Bad Request',
    status: 400,
    detail: 'X-Tenant-Id header is required.',
  });
}

export function invalidTenantHeaderProblem(): ProblemError {
  return new ProblemError({
    type: 'about:blank',
    title: 'Bad Request',
    status: 400,
    detail: 'X-Tenant-Id header must be a valid UUID.',
  });
}

export function tenantContextForbiddenProblem(): ProblemError {
  return new ProblemError({
    type: 'about:blank',
    title: 'Forbidden',
    status: 403,
    detail: 'Tenant context is not available for this user.',
  });
}

export function permissionForbiddenProblem(): ProblemError {
  return new ProblemError({
    type: 'about:blank',
    title: 'Forbidden',
    status: 403,
    detail: 'You do not have permission to perform this operation.',
  });
}

function invalidRequestProblem(error: z.ZodError): ProblemDetails {
  return {
    type: 'about:blank',
    title: 'Bad Request',
    status: 400,
    detail: 'The request data is invalid.',
    errors: error.issues.map((issue) => ({
      path: issue.path.join('.') || 'body',
      message: issue.message,
    })),
  };
}

function malformedJsonProblem(): ProblemDetails {
  return {
    type: 'about:blank',
    title: 'Bad Request',
    status: 400,
    detail: 'The request body must contain valid JSON.',
  };
}

function internalErrorProblem(): ProblemDetails {
  return {
    type: 'about:blank',
    title: 'Internal Server Error',
    status: 500,
    detail: 'An unexpected error occurred.',
  };
}

function sendProblem(response: Response, problem: ProblemDetails): void {
  response
    .status(problem.status)
    .type('application/problem+json')
    .json(problemDetailsSchema.parse(problem));
}

export const problemDetailsHandler: ErrorRequestHandler = (
  error,
  _request,
  response,
  next,
) => {
  void next;

  if (error instanceof ProblemError) {
    sendProblem(response, error.problem);
    return;
  }

  if (error instanceof z.ZodError) {
    sendProblem(response, invalidRequestProblem(error));
    return;
  }

  if (error instanceof SyntaxError && 'body' in error) {
    sendProblem(response, malformedJsonProblem());
    return;
  }

  console.error('Unexpected request error');
  sendProblem(response, internalErrorProblem());
};

'use client';

import {
  problemDetailsSchema,
  type ProblemDetails,
} from '@candidate-compliance/contracts';

interface ResponseSchema<T> {
  safeParse(
    value: unknown,
  ): { success: true; data: T } | { success: false; error: unknown };
}

export class FrontendRequestError extends Error {
  constructor(public readonly problem: ProblemDetails) {
    super(problem.detail);
  }
}

function unavailableProblem(): ProblemDetails {
  return {
    type: 'about:blank',
    title: 'Service unavailable',
    status: 502,
    detail: 'The service could not complete the request. Please try again.',
  };
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export async function requestFrontend<T>(
  path: string,
  schema: ResponseSchema<T>,
  init?: RequestInit,
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
      signal: init?.signal ?? AbortSignal.timeout(8_000),
    });
  } catch {
    throw new FrontendRequestError(unavailableProblem());
  }

  const body = await readBody(response);

  if (!response.ok) {
    const problem = problemDetailsSchema.safeParse(body);
    throw new FrontendRequestError(
      problem.success ? problem.data : unavailableProblem(),
    );
  }

  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    throw new FrontendRequestError(unavailableProblem());
  }

  return parsed.data;
}

export async function requestFrontendNoContent(
  path: string,
  init?: RequestInit,
): Promise<void> {
  let response: Response;

  try {
    response = await fetch(path, {
      ...init,
      headers: { Accept: 'application/json', ...init?.headers },
      signal: init?.signal ?? AbortSignal.timeout(8_000),
    });
  } catch {
    throw new FrontendRequestError(unavailableProblem());
  }

  if (response.status === 204) {
    return;
  }

  const body = await readBody(response);
  const problem = problemDetailsSchema.safeParse(body);
  throw new FrontendRequestError(
    problem.success ? problem.data : unavailableProblem(),
  );
}

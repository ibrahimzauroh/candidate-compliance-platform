import {
  problemDetailsSchema,
  type ProblemDetails,
} from '@candidate-compliance/contracts';

interface ResponseSchema<T> {
  safeParse(
    value: unknown,
  ): { success: true; data: T } | { success: false; error: unknown };
}

interface ApiRequestOptions<T> {
  path: string;
  schema: ResponseSchema<T>;
  method?: 'GET' | 'POST';
  token?: string;
  tenantId?: string;
  body?: unknown;
}

const DEFAULT_API_ORIGIN = 'http://localhost:4000';
const REQUEST_TIMEOUT_MS = 8_000;

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly problem: ProblemDetails,
  ) {
    super(problem.detail);
  }
}

function safeApiOrigin(): string {
  const configured =
    process.env.API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    DEFAULT_API_ORIGIN;
  const parsed = new URL(configured);

  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username) {
    throw new Error('The API origin configuration is invalid.');
  }

  return parsed.origin;
}

function fallbackProblem(status = 502): ProblemDetails {
  return {
    type: 'about:blank',
    title: status === 401 ? 'Unauthorized' : 'Service unavailable',
    status,
    detail:
      status === 401
        ? 'Your session is no longer valid. Please sign in again.'
        : 'The service could not complete the request. Please try again.',
  };
}

function boundedProblem(
  value: unknown,
  responseStatus: number,
): ProblemDetails {
  const parsed = problemDetailsSchema.safeParse(value);

  if (!parsed.success || parsed.data.status !== responseStatus) {
    return fallbackProblem(responseStatus === 401 ? 401 : 502);
  }

  if (responseStatus >= 500) {
    return fallbackProblem(502);
  }

  return {
    type: parsed.data.type.slice(0, 200),
    title: parsed.data.title.slice(0, 100),
    status: parsed.data.status,
    detail: parsed.data.detail.slice(0, 500),
    errors: parsed.data.errors?.slice(0, 20).map((error) => ({
      path: error.path.slice(0, 100),
      message: error.message.slice(0, 300),
    })),
  };
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type');

  if (!contentType?.toLowerCase().includes('json')) {
    return undefined;
  }

  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export async function requestApi<T>({
  path,
  schema,
  method = 'GET',
  token,
  tenantId,
  body,
}: ApiRequestOptions<T>): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' });

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (tenantId) {
    headers.set('X-Tenant-Id', tenantId);
  }

  if (body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;

  try {
    response = await fetch(`${safeApiOrigin()}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new ApiRequestError(502, fallbackProblem());
  }

  const value = await readJson(response);

  if (!response.ok) {
    const problem = boundedProblem(value, response.status);
    throw new ApiRequestError(problem.status, problem);
  }

  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    throw new ApiRequestError(502, fallbackProblem());
  }

  return parsed.data;
}

export function problemResponse(error: unknown): {
  problem: ProblemDetails;
  status: number;
} {
  if (error instanceof ApiRequestError) {
    return { problem: error.problem, status: error.problem.status };
  }

  const problem = fallbackProblem();
  return { problem, status: problem.status };
}

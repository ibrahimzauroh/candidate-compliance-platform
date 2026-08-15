import {
  loginRequestSchema,
  loginResponseSchema,
} from '@candidate-compliance/contracts';
import { type NextRequest, NextResponse } from 'next/server';

import { isSameOriginRequest } from '../../../../lib/request-security';
import {
  invalidFrontendRequestProblem,
  jsonProblem,
  requestErrorResponse,
  sameOriginProblem,
} from '../../../../lib/route-response';
import { requestApi } from '../../../../lib/server-api';
import {
  expiredCookieOptions,
  sessionCookieOptions,
  SESSION_COOKIE_NAME,
  TENANT_COOKIE_NAME,
} from '../../../../lib/session-cookies';

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) {
    return jsonProblem(sameOriginProblem);
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonProblem(invalidFrontendRequestProblem);
  }

  const input = loginRequestSchema.safeParse(body);

  if (!input.success) {
    return jsonProblem({
      ...invalidFrontendRequestProblem,
      errors: input.error.issues.map((issue) => ({
        path: issue.path.join('.') || 'body',
        message: issue.message,
      })),
    });
  }

  try {
    const result = await requestApi({
      path: '/api/v1/auth/login',
      schema: loginResponseSchema,
      method: 'POST',
      body: input.data,
    });
    const response = NextResponse.json(result.user, { status: 200 });

    response.cookies.set(
      SESSION_COOKIE_NAME,
      result.accessToken,
      sessionCookieOptions,
    );
    response.cookies.set(TENANT_COOKIE_NAME, '', expiredCookieOptions);

    return response;
  } catch (error) {
    return requestErrorResponse(error);
  }
}

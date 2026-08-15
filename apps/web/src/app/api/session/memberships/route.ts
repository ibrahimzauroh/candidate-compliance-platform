import { membershipListResponseSchema } from '@candidate-compliance/contracts';
import { type NextRequest, NextResponse } from 'next/server';

import {
  authenticationRequiredProblem,
  clearSessionCookies,
  jsonProblem,
  requestErrorResponse,
} from '../../../../lib/route-response';
import { requestApi } from '../../../../lib/server-api';
import { SESSION_COOKIE_NAME } from '../../../../lib/session-cookies';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    const response = jsonProblem(authenticationRequiredProblem);
    clearSessionCookies(response);
    return response;
  }

  try {
    const memberships = await requestApi({
      path: '/api/v1/memberships',
      schema: membershipListResponseSchema,
      token,
    });

    return NextResponse.json(memberships, { status: 200 });
  } catch (error) {
    return requestErrorResponse(error);
  }
}

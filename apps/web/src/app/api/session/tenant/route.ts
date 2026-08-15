import {
  membershipListResponseSchema,
  tenantContextSchema,
} from '@candidate-compliance/contracts';
import { type NextRequest, NextResponse } from 'next/server';

import { isSameOriginRequest } from '../../../../lib/request-security';
import {
  authenticationRequiredProblem,
  clearSessionCookies,
  invalidFrontendRequestProblem,
  jsonProblem,
  requestErrorResponse,
  sameOriginProblem,
} from '../../../../lib/route-response';
import { requestApi } from '../../../../lib/server-api';
import {
  sessionCookieOptions,
  SESSION_COOKIE_NAME,
  TENANT_COOKIE_NAME,
} from '../../../../lib/session-cookies';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function tenantIdFrom(value: unknown): string | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !('tenantId' in value) ||
    typeof value.tenantId !== 'string' ||
    !uuidPattern.test(value.tenantId)
  ) {
    return null;
  }

  return value.tenantId;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) {
    return jsonProblem(sameOriginProblem);
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    const response = jsonProblem(authenticationRequiredProblem);
    clearSessionCookies(response);
    return response;
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonProblem(invalidFrontendRequestProblem);
  }

  const tenantId = tenantIdFrom(body);

  if (!tenantId) {
    return jsonProblem(invalidFrontendRequestProblem);
  }

  try {
    const membershipResponse = await requestApi({
      path: '/api/v1/memberships',
      schema: membershipListResponseSchema,
      token,
    });
    const membership = membershipResponse.memberships.find(
      (option) => option.tenantId === tenantId,
    );

    if (!membership) {
      return jsonProblem({
        type: 'about:blank',
        title: 'Forbidden',
        status: 403,
        detail: 'The selected tenant context is not available.',
      });
    }

    const tenantContext = await requestApi({
      path: '/api/v1/context',
      schema: tenantContextSchema,
      token,
      tenantId: membership.tenantId,
    });

    if (
      tenantContext.tenantId !== membership.tenantId ||
      tenantContext.membershipId !== membership.membershipId ||
      tenantContext.role !== membership.role
    ) {
      return jsonProblem({
        type: 'about:blank',
        title: 'Forbidden',
        status: 403,
        detail: 'The selected tenant context could not be validated.',
      });
    }

    const response = NextResponse.json(tenantContext, { status: 200 });
    response.cookies.set(
      TENANT_COOKIE_NAME,
      membership.tenantId,
      sessionCookieOptions,
    );
    return response;
  } catch (error) {
    return requestErrorResponse(error);
  }
}

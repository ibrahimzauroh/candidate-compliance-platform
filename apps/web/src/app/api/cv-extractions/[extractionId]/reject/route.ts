import {
  cvExtractionIdParamsSchema,
  cvExtractionSchema,
} from '@candidate-compliance/contracts';
import { type NextRequest, NextResponse } from 'next/server';

import { deriveCvIdempotencyKey } from '../../../../../lib/cv-idempotency';
import { isSameOriginRequest } from '../../../../../lib/request-security';
import {
  authenticationRequiredProblem,
  clearSessionCookies,
  invalidFrontendRequestProblem,
  jsonProblem,
  requestErrorResponse,
  sameOriginProblem,
} from '../../../../../lib/route-response';
import { requestApi } from '../../../../../lib/server-api';
import {
  SESSION_COOKIE_NAME,
  TENANT_COOKIE_NAME,
} from '../../../../../lib/session-cookies';
import { validateTenantSession } from '../../../../../lib/session';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface RejectRouteContext {
  params: Promise<{ extractionId: string }>;
}

function parseAttempt(value: unknown): string | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !('attemptId' in value) ||
    typeof value.attemptId !== 'string' ||
    !uuidPattern.test(value.attemptId)
  ) {
    return null;
  }

  return value.attemptId;
}

export async function POST(
  request: NextRequest,
  context: RejectRouteContext,
): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) {
    return jsonProblem(sameOriginProblem);
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    const response = jsonProblem(authenticationRequiredProblem);
    clearSessionCookies(response);
    return response;
  }

  const params = cvExtractionIdParamsSchema.safeParse(await context.params);
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonProblem(invalidFrontendRequestProblem);
  }

  const attemptId = parseAttempt(body);

  if (!params.success || !attemptId) {
    return jsonProblem(invalidFrontendRequestProblem);
  }

  try {
    const session = await validateTenantSession(
      token,
      request.cookies.get(TENANT_COOKIE_NAME)?.value,
    );

    if (!session) {
      return jsonProblem({
        type: 'about:blank',
        title: 'Forbidden',
        status: 403,
        detail: 'A validated tenant context is required.',
      });
    }

    const extraction = await requestApi({
      path: `/api/v1/cv-extractions/${params.data.extractionId}/reject`,
      schema: cvExtractionSchema,
      method: 'POST',
      token,
      tenantId: session.tenantContext.tenantId,
      idempotencyKey: deriveCvIdempotencyKey({
        actorId: session.user.id,
        attemptId,
        extractionId: params.data.extractionId,
        operation: 'reject',
        sessionCredential: token,
        tenantId: session.tenantContext.tenantId,
      }),
      body: {},
    });

    if (
      extraction.id !== params.data.extractionId ||
      extraction.status !== 'REJECTED' ||
      extraction.confirmedOutput !== null
    ) {
      return jsonProblem({
        type: 'about:blank',
        title: 'Service unavailable',
        status: 502,
        detail: 'The service could not complete the request. Please try again.',
      });
    }

    return NextResponse.json(extraction);
  } catch (error) {
    return requestErrorResponse(error);
  }
}

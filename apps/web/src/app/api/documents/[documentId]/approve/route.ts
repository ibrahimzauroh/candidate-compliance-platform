import {
  complianceDocumentSchema,
  documentIdParamsSchema,
} from '@candidate-compliance/contracts';
import { type NextRequest, NextResponse } from 'next/server';

import { deriveComplianceDocumentLifecycleIdempotencyKey } from '../../../../../lib/compliance-document-idempotency';
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

interface ApprovalRouteContext {
  params: Promise<{ documentId: string }>;
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
  context: ApprovalRouteContext,
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

  const params = documentIdParamsSchema.safeParse(await context.params);

  if (!params.success) {
    return jsonProblem(invalidFrontendRequestProblem);
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonProblem(invalidFrontendRequestProblem);
  }

  const attemptId = parseAttempt(body);

  if (!attemptId) {
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

    const document = await requestApi({
      path: `/api/v1/documents/${params.data.documentId}/approve`,
      schema: complianceDocumentSchema,
      method: 'POST',
      token,
      tenantId: session.tenantContext.tenantId,
      idempotencyKey: deriveComplianceDocumentLifecycleIdempotencyKey({
        actorId: session.user.id,
        attemptId,
        documentId: params.data.documentId,
        operation: 'approve',
        sessionCredential: token,
        tenantId: session.tenantContext.tenantId,
      }),
      body: {},
    });

    if (document.id !== params.data.documentId) {
      return jsonProblem({
        type: 'about:blank',
        title: 'Service unavailable',
        status: 502,
        detail: 'The service could not complete the request. Please try again.',
      });
    }

    return NextResponse.json(document);
  } catch (error) {
    return requestErrorResponse(error);
  }
}

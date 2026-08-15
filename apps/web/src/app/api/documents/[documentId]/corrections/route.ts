import {
  complianceDocumentSchema,
  correctComplianceDocumentRequestSchema,
  documentIdParamsSchema,
  type CorrectComplianceDocumentRequest,
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

interface CorrectionEnvelope {
  attemptId: string;
  correction: CorrectComplianceDocumentRequest;
}

interface CorrectionRouteContext {
  params: Promise<{ documentId: string }>;
}

function parseEnvelope(value: unknown): CorrectionEnvelope | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !('attemptId' in value) ||
    typeof value.attemptId !== 'string' ||
    !uuidPattern.test(value.attemptId) ||
    !('correction' in value)
  ) {
    return null;
  }

  const correction = correctComplianceDocumentRequestSchema.safeParse(
    value.correction,
  );

  return correction.success
    ? { attemptId: value.attemptId, correction: correction.data }
    : null;
}

export async function POST(
  request: NextRequest,
  context: CorrectionRouteContext,
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
  const rawParams = await context.params;

  const params = documentIdParamsSchema.safeParse({
    documentId: rawParams.documentId,
  });

  if (!params.success) {
    return jsonProblem(invalidFrontendRequestProblem);
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonProblem(invalidFrontendRequestProblem);
  }

  const envelope = parseEnvelope(body);

  if (!envelope) {
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
      path: `/api/v1/documents/${params.data.documentId}/corrections`,
      schema: complianceDocumentSchema,
      method: 'POST',
      token,
      tenantId: session.tenantContext.tenantId,
      idempotencyKey: deriveComplianceDocumentLifecycleIdempotencyKey({
        actorId: session.user.id,
        attemptId: envelope.attemptId,
        documentId: params.data.documentId,
        input: envelope.correction,
        operation: 'correct',
        sessionCredential: token,
        tenantId: session.tenantContext.tenantId,
      }),
      body: envelope.correction,
    });

    if (
      document.id !== params.data.documentId ||
      document.currentVersion.status !== 'DRAFT'
    ) {
      return jsonProblem({
        type: 'about:blank',
        title: 'Service unavailable',
        status: 502,
        detail: 'The service could not complete the request. Please try again.',
      });
    }

    return NextResponse.json(document, { status: 201 });
  } catch (error) {
    return requestErrorResponse(error);
  }
}

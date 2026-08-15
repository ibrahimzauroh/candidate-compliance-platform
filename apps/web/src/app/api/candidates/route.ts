import {
  candidateSchema,
  createCandidateRequestSchema,
  type CreateCandidateRequest,
} from '@candidate-compliance/contracts';
import { type NextRequest, NextResponse } from 'next/server';

import { deriveCandidateIdempotencyKey } from '../../../lib/candidate-idempotency';
import { isSameOriginRequest } from '../../../lib/request-security';
import {
  authenticationRequiredProblem,
  clearSessionCookies,
  invalidFrontendRequestProblem,
  jsonProblem,
  requestErrorResponse,
  sameOriginProblem,
} from '../../../lib/route-response';
import { requestApi } from '../../../lib/server-api';
import {
  SESSION_COOKIE_NAME,
  TENANT_COOKIE_NAME,
} from '../../../lib/session-cookies';
import { validateTenantSession } from '../../../lib/session';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface CandidateCreateEnvelope {
  attemptId: string;
  candidate: CreateCandidateRequest;
}

function parseEnvelope(value: unknown): CandidateCreateEnvelope | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !('attemptId' in value) ||
    typeof value.attemptId !== 'string' ||
    !uuidPattern.test(value.attemptId) ||
    !('candidate' in value)
  ) {
    return null;
  }

  const candidate = createCandidateRequestSchema.safeParse(value.candidate);
  return candidate.success
    ? { attemptId: value.attemptId, candidate: candidate.data }
    : null;
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

    const candidate = await requestApi({
      path: '/api/v1/candidates',
      schema: candidateSchema,
      method: 'POST',
      token,
      tenantId: session.tenantContext.tenantId,
      idempotencyKey: deriveCandidateIdempotencyKey({
        actorId: session.user.id,
        attemptId: envelope.attemptId,
        input: envelope.candidate,
        sessionCredential: token,
        tenantId: session.tenantContext.tenantId,
      }),
      body: envelope.candidate,
    });

    return NextResponse.json(candidate, { status: 201 });
  } catch (error) {
    return requestErrorResponse(error);
  }
}

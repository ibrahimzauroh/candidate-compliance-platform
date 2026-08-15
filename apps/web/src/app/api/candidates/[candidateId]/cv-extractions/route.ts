import {
  candidateIdParamsSchema,
  cvExtractionSchema,
} from '@candidate-compliance/contracts';
import { createHash } from 'node:crypto';
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

const CV_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface CvUploadRouteContext {
  params: Promise<{ candidateId: string }>;
}

function mediaTypeFrom(
  request: NextRequest,
): 'application/pdf' | 'text/plain' | null {
  const mediaType = request.headers
    .get('content-type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase();

  return mediaType === 'application/pdf' || mediaType === 'text/plain'
    ? mediaType
    : null;
}

async function readBoundedBody(
  request: NextRequest,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const declaredLength = request.headers.get('content-length');

  if (
    declaredLength &&
    (!/^\d+$/.test(declaredLength) ||
      Number(declaredLength) > CV_UPLOAD_MAX_BYTES)
  ) {
    return null;
  }

  const reader = request.body?.getReader();

  if (!reader) {
    return null;
  }

  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    byteLength += value.byteLength;

    if (byteLength > CV_UPLOAD_MAX_BYTES) {
      await reader.cancel();
      return null;
    }

    chunks.push(value);
  }

  if (byteLength === 0) {
    return null;
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
}

export async function POST(
  request: NextRequest,
  context: CvUploadRouteContext,
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
  const params = candidateIdParamsSchema.safeParse({
    candidateId: rawParams.candidateId,
  });
  const attemptId = request.headers.get('x-cv-attempt-id');
  const mediaType = mediaTypeFrom(request);

  if (
    !params.success ||
    !attemptId ||
    !uuidPattern.test(attemptId) ||
    !mediaType
  ) {
    return jsonProblem(invalidFrontendRequestProblem);
  }

  const bytes = await readBoundedBody(request);

  if (!bytes) {
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
      path: `/api/v1/candidates/${params.data.candidateId}/cv-extractions`,
      schema: cvExtractionSchema,
      method: 'POST',
      token,
      tenantId: session.tenantContext.tenantId,
      idempotencyKey: deriveCvIdempotencyKey({
        actorId: session.user.id,
        attemptId,
        candidateId: params.data.candidateId,
        contentHash: createHash('sha256').update(bytes).digest('hex'),
        mediaType,
        operation: 'extract',
        sessionCredential: token,
        tenantId: session.tenantContext.tenantId,
      }),
      contentType: mediaType,
      rawBody: bytes,
    });

    if (
      extraction.candidateId !== params.data.candidateId ||
      extraction.status !== 'PROPOSED'
    ) {
      return jsonProblem({
        type: 'about:blank',
        title: 'Service unavailable',
        status: 502,
        detail: 'The service could not complete the request. Please try again.',
      });
    }

    return NextResponse.json(extraction, { status: 201 });
  } catch (error) {
    return requestErrorResponse(error);
  }
}

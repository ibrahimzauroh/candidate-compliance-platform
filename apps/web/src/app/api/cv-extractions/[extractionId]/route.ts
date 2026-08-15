import {
  cvExtractionIdParamsSchema,
  cvExtractionSchema,
} from '@candidate-compliance/contracts';
import { type NextRequest, NextResponse } from 'next/server';

import {
  authenticationRequiredProblem,
  clearSessionCookies,
  invalidFrontendRequestProblem,
  jsonProblem,
  requestErrorResponse,
} from '../../../../lib/route-response';
import { requestApi } from '../../../../lib/server-api';
import {
  SESSION_COOKIE_NAME,
  TENANT_COOKIE_NAME,
} from '../../../../lib/session-cookies';
import { validateTenantSession } from '../../../../lib/session';

interface CvExtractionRouteContext {
  params: Promise<{ extractionId: string }>;
}

export async function GET(
  request: NextRequest,
  context: CvExtractionRouteContext,
): Promise<NextResponse> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    const response = jsonProblem(authenticationRequiredProblem);
    clearSessionCookies(response);
    return response;
  }

  const params = cvExtractionIdParamsSchema.safeParse(await context.params);

  if (!params.success) {
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
      path: `/api/v1/cv-extractions/${params.data.extractionId}`,
      schema: cvExtractionSchema,
      token,
      tenantId: session.tenantContext.tenantId,
    });

    return NextResponse.json(extraction);
  } catch (error) {
    return requestErrorResponse(error);
  }
}

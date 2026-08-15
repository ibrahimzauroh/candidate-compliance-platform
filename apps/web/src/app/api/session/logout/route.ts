import { type NextRequest, NextResponse } from 'next/server';

import { isSameOriginRequest } from '../../../../lib/request-security';
import {
  clearSessionCookies,
  jsonProblem,
  sameOriginProblem,
} from '../../../../lib/route-response';

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginRequest(request)) {
    return jsonProblem(sameOriginProblem);
  }

  const response = new NextResponse(null, { status: 204 });
  clearSessionCookies(response);
  return response;
}

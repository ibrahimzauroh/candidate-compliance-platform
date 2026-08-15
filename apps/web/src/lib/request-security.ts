import type { NextRequest } from 'next/server';

export function isSameOriginRequest(request: NextRequest): boolean {
  const origin = request.headers.get('origin');

  if (!origin) {
    return false;
  }

  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

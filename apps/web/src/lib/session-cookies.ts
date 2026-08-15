export const SESSION_COOKIE_NAME = 'candidate_compliance_session';
export const TENANT_COOKIE_NAME = 'candidate_compliance_tenant';

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

export const expiredCookieOptions = {
  ...sessionCookieOptions,
  expires: new Date(0),
};

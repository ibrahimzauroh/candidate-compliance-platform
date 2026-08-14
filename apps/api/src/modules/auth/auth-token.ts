import jwt from 'jsonwebtoken';

import type { JwtConfig } from '../../config/jwt-config.js';

export function issueAccessToken(userId: string, config: JwtConfig): string {
  return jwt.sign({}, config.secret, {
    algorithm: 'HS256',
    expiresIn: config.expiresIn,
    subject: userId,
  });
}

export function verifyAccessToken(token: string, config: JwtConfig): string {
  const payload = jwt.verify(token, config.secret, {
    algorithms: ['HS256'],
  });

  if (typeof payload === 'string' || typeof payload.sub !== 'string') {
    throw new Error('Access token subject is missing.');
  }

  return payload.sub;
}

import type { RequestHandler } from 'express';

import { permissionForbiddenProblem } from '../../infrastructure/http/problem-details.js';
import { hasPermission, type Permission } from './permissions.js';

export function requirePermission(permission: Permission): RequestHandler {
  return (request, _response, next) => {
    const tenantContext = request.tenantContext;

    if (!tenantContext || !hasPermission(tenantContext, permission)) {
      next(permissionForbiddenProblem());
      return;
    }

    next();
  };
}

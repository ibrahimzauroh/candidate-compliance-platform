import type {
  AuthenticatedActor,
  TenantContext,
} from '@candidate-compliance/contracts';

declare global {
  namespace Express {
    interface Request {
      authenticatedActor?: AuthenticatedActor;
      tenantContext?: TenantContext;
    }
  }
}

export {};

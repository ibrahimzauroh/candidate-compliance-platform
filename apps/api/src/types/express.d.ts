import type { AuthenticatedActor } from '@candidate-compliance/contracts';

declare global {
  namespace Express {
    interface Request {
      authenticatedActor?: AuthenticatedActor;
    }
  }
}

export {};

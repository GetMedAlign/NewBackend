import { DomainError } from '../../../auth/domain/errors/domain-error';

export class RecommendationNotFoundError extends DomainError {
  constructor(sessionId: string) {
    super(`No assessment found for session '${sessionId}'`);
  }
}

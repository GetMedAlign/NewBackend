import { DomainError } from '../../../auth/domain/errors/domain-error';

/**
 * Thrown when a public clinic lookup (GET /clinics/:slug) finds no clinic
 * for the given slug. Scoped to the clinics module rather than reusing
 * leads' ClinicNotFoundError, which represents a different context (a lead
 * submission referencing a clinic id that does not exist).
 */
export class ClinicNotFoundError extends DomainError {
  constructor(slug: string) {
    super(`Clinic not found: '${slug}'`);
  }
}

import { DomainError } from '../../../auth/domain/errors/domain-error';

export class ClinicNotFoundError extends DomainError {
  constructor(identifier: string) {
    super(`Clinic not found: '${identifier}'`);
  }
}

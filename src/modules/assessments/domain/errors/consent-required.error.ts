import { DomainError } from '../../../auth/domain/errors/domain-error';

export class ConsentRequiredError extends DomainError {
  constructor() {
    super('Consent is required to submit an assessment');
  }
}

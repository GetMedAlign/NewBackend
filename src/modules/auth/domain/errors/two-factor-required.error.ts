import { DomainError } from './domain-error';

export class TwoFactorRequiredError extends DomainError {
  constructor() {
    super('Two-factor authentication required');
  }
}

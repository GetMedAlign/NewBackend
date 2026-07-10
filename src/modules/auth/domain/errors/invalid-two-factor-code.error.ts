import { DomainError } from './domain-error';

export class InvalidTwoFactorCodeError extends DomainError {
  constructor() {
    super('Invalid or expired two-factor code');
  }
}

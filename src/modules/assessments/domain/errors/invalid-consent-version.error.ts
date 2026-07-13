import { DomainError } from '../../../auth/domain/errors/domain-error';

export class InvalidConsentVersionError extends DomainError {
  constructor(version: string) {
    super(`Consent version '${version}' is not accepted`);
  }
}

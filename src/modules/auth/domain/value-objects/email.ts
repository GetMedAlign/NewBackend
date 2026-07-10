import { DomainError } from '../errors/domain-error';

export class InvalidEmailError extends DomainError {
  constructor(value: string) {
    super(`Invalid email address: "${value}"`);
  }
}

/**
 * Validates email format, lowercases and trims the value.
 * Uses a minimal RFC-5322 inspired regex: local@domain.tld.
 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class Email {
  private readonly value: string;

  private constructor(raw: string) {
    const normalised = raw.trim().toLowerCase();
    if (!normalised || !EMAIL_REGEX.test(normalised)) {
      throw new InvalidEmailError(raw.trim());
    }
    this.value = normalised;
  }

  static create(raw: string): Email {
    return new Email(raw);
  }

  toString(): string {
    return this.value;
  }
}

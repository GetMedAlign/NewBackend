import { DomainError } from './domain-error';

export class AccountLockedError extends DomainError {
  constructor(public readonly lockedUntil: Date) {
    super(`Account locked until ${lockedUntil.toISOString()}`);
  }
}

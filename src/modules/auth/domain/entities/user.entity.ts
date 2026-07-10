export interface UserProps {
  id: string;
  email: string;
  passwordHash: string;
  emailConfirmed: boolean;
  failedLoginCount: number;
  lockedUntil: Date | null;
}

export class User {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly emailConfirmed: boolean;
  readonly failedLoginCount: number;
  readonly lockedUntil: Date | null;

  constructor(props: UserProps) {
    this.id = props.id;
    this.email = props.email;
    this.passwordHash = props.passwordHash;
    this.emailConfirmed = props.emailConfirmed;
    this.failedLoginCount = props.failedLoginCount;
    this.lockedUntil = props.lockedUntil;
  }

  /** Returns true when the account lock has not yet expired. */
  isLocked(now: Date): boolean {
    if (this.lockedUntil === null) return false;
    return this.lockedUntil.getTime() > now.getTime();
  }
}

import { Injectable, Inject } from '@nestjs/common';
import { InvalidCredentialsError } from '../domain/errors/invalid-credentials.error';
import { AccountLockedError } from '../domain/errors/account-locked.error';
import { PasswordHasherPort, PASSWORD_HASHER } from '../domain/ports/password-hasher.port';
import { TwoFactorPort, TWO_FACTOR } from '../domain/ports/two-factor.port';
import { UserRepositoryPort, USER_REPOSITORY } from '../domain/ports/user-repository.port';
import { AuditPort, AUDIT } from '../domain/ports/audit.port';

/**
 * A constant valid Argon2id hash used for timing-equalisation when a user is
 * not found, preventing user-enumeration via response-time differences.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$RdescudvJCsgt3ub+b+dWRWJTmaasfNfOptZe7aOnXc';

/**
 * The user's role is not yet confirmed at this stage — identity is only
 * established once the 2FA step succeeds.
 */
const PRE_AUTH_ROLE = 'pre_auth';

export interface SignInInput {
  email: string;
  password: string;
  ip?: string;
}

export interface SignInOutput {
  requiresTwoFactor: true;
}

@Injectable()
export class SignInUseCase {
  constructor(
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasherPort,
    @Inject(TWO_FACTOR) private readonly twoFactor: TwoFactorPort,
    @Inject(USER_REPOSITORY) private readonly repo: UserRepositoryPort,
    @Inject(AUDIT) private readonly audit: AuditPort,
  ) {}

  async execute(input: SignInInput): Promise<SignInOutput> {
    const user = await this.repo.findByEmail(input.email);

    if (user === null) {
      // Equalise timing — always run the hash verification to prevent enumeration.
      await this.hasher.verify(input.password, DUMMY_HASH);
      throw new InvalidCredentialsError();
    }

    if (user.isLocked(new Date())) {
      throw new AccountLockedError(user.lockedUntil!);
    }

    const valid = await this.hasher.verify(input.password, user.passwordHash);
    if (!valid) {
      await this.repo.recordFailedLogin(user.id);
      throw new InvalidCredentialsError();
    }

    await this.twoFactor.issueCode(user.id);

    await this.audit.record({
      actorUserId: user.id,
      actorRole: PRE_AUTH_ROLE,
      ip: input.ip ?? null,
      actionType: 'signin_2fa_issued',
      affectedRecord: user.id,
    });

    return { requiresTwoFactor: true };
  }
}

import { Injectable, Inject } from '@nestjs/common';
import { InvalidTwoFactorCodeError } from '../domain/errors/invalid-two-factor-code.error';
import { TokenServicePort, TOKEN_SERVICE } from '../domain/ports/token-service.port';
import { TwoFactorPort, TWO_FACTOR } from '../domain/ports/two-factor.port';
import { UserRepositoryPort, USER_REPOSITORY } from '../domain/ports/user-repository.port';
import { AuditPort, AUDIT } from '../domain/ports/audit.port';

export interface VerifyTwoFactorInput {
  email: string;
  code: string;
  ip?: string;
}

export interface VerifyTwoFactorOutput {
  token: string;
  userId: string;
  role: string;
  name: string | null;
  email: string;
  clinicId: string | null;
}

@Injectable()
export class VerifyTwoFactorUseCase {
  constructor(
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenServicePort,
    @Inject(TWO_FACTOR) private readonly twoFactor: TwoFactorPort,
    @Inject(USER_REPOSITORY) private readonly repo: UserRepositoryPort,
    @Inject(AUDIT) private readonly audit: AuditPort,
  ) {}

  async execute(input: VerifyTwoFactorInput): Promise<VerifyTwoFactorOutput> {
    const user = await this.repo.findByEmail(input.email);

    if (user === null) {
      // Uniform response — do not reveal whether the email exists.
      throw new InvalidTwoFactorCodeError();
    }

    const valid = await this.twoFactor.verifyCode(user.id, input.code);
    if (!valid) {
      throw new InvalidTwoFactorCodeError();
    }

    await this.repo.resetFailedLogin(user.id);

    const role = await this.repo.getPrimaryRole(user.id);
    const clinicId = await this.repo.getClinicId(user.id);
    const token = this.tokens.issue({ sub: user.id, role, clinicId });

    await this.audit.record({
      actorUserId: user.id,
      actorRole: role,
      ip: input.ip ?? null,
      actionType: 'signin_succeeded',
      affectedRecord: user.id,
    });

    return { token, userId: user.id, role, name: user.name, email: user.email, clinicId };
  }
}

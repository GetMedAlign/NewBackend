import { Injectable, Inject } from '@nestjs/common';
import { TwoFactorPort, TWO_FACTOR } from '../domain/ports/two-factor.port';
import {
  UserRepositoryPort,
  USER_REPOSITORY,
} from '../domain/ports/user-repository.port';

export interface ResendTwoFactorInput {
  email: string;
}

export interface ResendTwoFactorOutput {
  ok: true;
}

@Injectable()
export class ResendTwoFactorUseCase {
  constructor(
    @Inject(TWO_FACTOR) private readonly twoFactor: TwoFactorPort,
    @Inject(USER_REPOSITORY) private readonly repo: UserRepositoryPort,
  ) {}

  async execute(input: ResendTwoFactorInput): Promise<ResendTwoFactorOutput> {
    const user = await this.repo.findByEmail(input.email);

    // Always return ok — never reveal whether the email exists.
    if (user !== null) {
      await this.twoFactor.issueCode(user.id);
    }

    return { ok: true };
  }
}

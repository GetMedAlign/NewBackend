import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { USER_REPOSITORY } from '../domain/ports/user-repository.port';
import type { UserRepositoryPort } from '../domain/ports/user-repository.port';
import { EmailConfirmTokenService } from '../domain/email-confirm-token.service';

@Injectable()
export class ConfirmEmailUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepositoryPort,
    private readonly tokens: EmailConfirmTokenService,
  ) {}

  async execute(email: string, token: string): Promise<{ success: true }> {
    if (!this.tokens.verify(email, token)) {
      throw new BadRequestException('Invalid confirmation token');
    }
    // Idempotent: setting an already-confirmed account stays true.
    await this.users.setEmailConfirmed(email);
    return { success: true };
  }
}

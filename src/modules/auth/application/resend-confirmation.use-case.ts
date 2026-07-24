import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { USER_REPOSITORY } from '../domain/ports/user-repository.port';
import type { UserRepositoryPort } from '../domain/ports/user-repository.port';
import { EMAIL_SENDER } from '../infrastructure/adapters/email-sender.port';
import type { EmailSenderPort } from '../infrastructure/adapters/email-sender.port';
import { EmailConfirmTokenService } from '../domain/email-confirm-token.service';
import { buildConfirmationLink } from '../domain/confirmation-email';

@Injectable()
export class ResendConfirmationUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepositoryPort,
    @Inject(EMAIL_SENDER) private readonly emailSender: EmailSenderPort,
    private readonly tokens: EmailConfirmTokenService,
    private readonly config: ConfigService,
  ) {}

  async execute(email: string): Promise<{ success: true }> {
    try {
      const user = await this.users.findByEmail(email);
      if (user && !user.emailConfirmed) {
        const link = buildConfirmationLink(this.config, this.tokens, email);
        await this.emailSender.send(email, 'Confirm your email', link);
      }
    } catch {
      // Enumeration-safe: never reveal whether the account exists.
    }
    return { success: true };
  }
}

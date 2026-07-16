import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  PasswordResetRepositoryPort,
  PASSWORD_RESET_REPOSITORY,
} from '../domain/ports/password-reset-repository.port';
import { EmailSenderPort, EMAIL_SENDER } from '../infrastructure/adapters/email-sender.port';
import { generateResetToken, RESET_TOKEN_TTL_MINUTES } from '../domain/reset-token';

@Injectable()
export class ForgotPasswordUseCase {
  constructor(
    @Inject(PASSWORD_RESET_REPOSITORY) private readonly resetRepo: PasswordResetRepositoryPort,
    @Inject(EMAIL_SENDER) private readonly emailSender: EmailSenderPort,
    private readonly config: ConfigService,
  ) {}

  async execute({ email }: { email: string }): Promise<{ success: true }> {
    try {
      const userId = await this.resetRepo.findUserIdByEmail(email);
      if (userId) {
        const { raw, hash } = generateResetToken();
        const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);
        await this.resetRepo.issue(userId, hash, expiresAt);
        const baseUrl = this.config.get<string>('APP_BASE_URL');
        const link = `${baseUrl}/reset-password?email=${encodeURIComponent(email)}&token=${raw}`;
        await this.emailSender.send(email, 'Reset your password', link);
      }
    } catch {
      // enumeration-safe: swallow all errors
    }
    return { success: true };
  }
}

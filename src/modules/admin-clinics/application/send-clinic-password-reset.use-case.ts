import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AdminCtx } from '../../../infrastructure/security/admin-ctx';
import { ADMIN_CLINIC_REPOSITORY } from '../domain/ports/admin-clinic-repository.port';
import type { AdminClinicRepositoryPort } from '../domain/ports/admin-clinic-repository.port';
import {
  PASSWORD_RESET_REPOSITORY,
  PasswordResetRepositoryPort,
} from '../../auth/domain/ports/password-reset-repository.port';
import {
  EMAIL_SENDER,
  EmailSenderPort,
} from '../../auth/infrastructure/adapters/email-sender.port';
import { generateResetToken, RESET_TOKEN_TTL_MINUTES } from '../../auth/domain/reset-token';

/**
 * POST /admin/clinics/:id/set-password sibling: emails a password reset link
 * to the clinic's linked user. Unlike /auth/forgot-password, this route is
 * NOT enumeration-safe — the caller is an authenticated admin who must know
 * when there is no linked user to reset (spec §2.1).
 */
@Injectable()
export class SendClinicPasswordResetUseCase {
  constructor(
    @Inject(ADMIN_CLINIC_REPOSITORY) private readonly repo: AdminClinicRepositoryPort,
    @Inject(PASSWORD_RESET_REPOSITORY) private readonly resetRepo: PasswordResetRepositoryPort,
    @Inject(EMAIL_SENDER) private readonly emailSender: EmailSenderPort,
    private readonly config: ConfigService,
  ) {}

  async execute(ctx: AdminCtx, clinicId: string): Promise<{ success: true }> {
    const clinicUser = await this.repo.findClinicUser(ctx, clinicId);
    if (!clinicUser) throw new NotFoundException('No user account found for this clinic.');

    const { raw, hash } = generateResetToken();
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);
    await this.resetRepo.issue(clinicUser.userId, hash, expiresAt);

    const baseUrl = this.config.get<string>('APP_BASE_URL');
    const link = `${baseUrl}/reset-password?email=${encodeURIComponent(clinicUser.email)}&token=${raw}`;
    await this.emailSender.send(clinicUser.email, 'Reset your password', link);

    return { success: true };
  }
}

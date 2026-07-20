import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AdminCtx } from '../../../infrastructure/security/admin-ctx';
import { ADMIN_PATIENT_REPOSITORY } from '../domain/ports/admin-patient-repository.port';
import type { AdminPatientRepositoryPort } from '../domain/ports/admin-patient-repository.port';
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
 * POST /admin/patients/:id/send-password-reset sibling: emails a password
 * reset link to the patient's linked user. Unlike /auth/forgot-password, this
 * route is NOT enumeration-safe — the caller is an authenticated admin who
 * must know when the patient does not exist (spec §2.1, mirrors Task 7's
 * send-clinic-password-reset.use-case.ts).
 */
@Injectable()
export class SendPatientPasswordResetUseCase {
  constructor(
    @Inject(ADMIN_PATIENT_REPOSITORY) private readonly repo: AdminPatientRepositoryPort,
    @Inject(PASSWORD_RESET_REPOSITORY) private readonly resetRepo: PasswordResetRepositoryPort,
    @Inject(EMAIL_SENDER) private readonly emailSender: EmailSenderPort,
    private readonly config: ConfigService,
  ) {}

  async execute(ctx: AdminCtx, patientId: string): Promise<{ success: true }> {
    const patientUser = await this.repo.findPatientUser(ctx, patientId);
    if (!patientUser) throw new NotFoundException('Patient not found.');

    const { raw, hash } = generateResetToken();
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);
    await this.resetRepo.issue(patientUser.userId, hash, expiresAt);

    const baseUrl = this.config.get<string>('APP_BASE_URL');
    const link = `${baseUrl}/reset-password?email=${encodeURIComponent(patientUser.email)}&token=${raw}`;
    await this.emailSender.send(patientUser.email, 'Reset your password', link);

    return { success: true };
  }
}

import { Injectable, Inject, BadRequestException } from '@nestjs/common';

import {
  PasswordResetRepositoryPort,
  PASSWORD_RESET_REPOSITORY,
} from '../domain/ports/password-reset-repository.port';
import { PasswordHasherPort, PASSWORD_HASHER } from '../domain/ports/password-hasher.port';
import { hashResetToken } from '../domain/reset-token';

@Injectable()
export class ResetPasswordUseCase {
  constructor(
    @Inject(PASSWORD_RESET_REPOSITORY) private readonly resetRepo: PasswordResetRepositoryPort,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasherPort,
  ) {}

  async execute({
    email,
    token,
    newPassword,
  }: {
    email: string;
    token: string;
    newPassword: string;
  }): Promise<{ success: true }> {
    const record = await this.resetRepo.findValidByEmail(email, hashResetToken(token));
    if (!record) throw new BadRequestException('Invalid or expired reset token');
    const passwordHash = await this.hasher.hash(newPassword);
    await this.resetRepo.updatePasswordHash(record.userId, passwordHash);
    await this.resetRepo.consume(record.id);
    return { success: true };
  }
}

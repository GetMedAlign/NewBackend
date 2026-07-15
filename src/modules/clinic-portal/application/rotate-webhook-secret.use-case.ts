import { Injectable, Inject } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { CLINIC_WEBHOOK_REPOSITORY } from '../domain/ports/clinic-webhook-repository.port';
import type { ClinicWebhookRepositoryPort } from '../domain/ports/clinic-webhook-repository.port';
import { ENCRYPTION_PORT } from '../../auth/domain/ports/encryption.port';
import type { EncryptionPort } from '../../auth/domain/ports/encryption.port';

@Injectable()
export class RotateWebhookSecretUseCase {
  constructor(
    @Inject(CLINIC_WEBHOOK_REPOSITORY)
    private readonly repo: ClinicWebhookRepositoryPort,
    @Inject(ENCRYPTION_PORT)
    private readonly encryption: EncryptionPort,
  ) {}

  async execute(clinicId: string): Promise<{ webhookSecret: string }> {
    const secret = randomBytes(32).toString('hex');
    const ciphertext = this.encryption.encrypt(secret);
    await this.repo.rotateWebhookSecret(clinicId, ciphertext);
    return { webhookSecret: secret };
  }
}

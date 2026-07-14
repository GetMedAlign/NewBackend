import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { CLINIC_WEBHOOK_REPOSITORY } from '../domain/ports/clinic-webhook-repository.port';
import type {
  ClinicWebhookRepositoryPort,
  WebhookDeliveryDto,
} from '../domain/ports/clinic-webhook-repository.port';
import { ENCRYPTION_PORT } from '../../auth/domain/ports/encryption.port';
import type { EncryptionPort } from '../../auth/domain/ports/encryption.port';
import { WEBHOOK_SENDER } from '../../leads/domain/ports/webhook-sender.port';
import type { WebhookSenderPort } from '../../leads/domain/ports/webhook-sender.port';

@Injectable()
export class TestWebhookUseCase {
  constructor(
    @Inject(CLINIC_WEBHOOK_REPOSITORY)
    private readonly repo: ClinicWebhookRepositoryPort,
    @Inject(ENCRYPTION_PORT)
    private readonly encryption: EncryptionPort,
    @Inject(WEBHOOK_SENDER)
    private readonly webhookSender: WebhookSenderPort,
  ) {}

  async execute(clinicId: string, webhookUrl: string): Promise<WebhookDeliveryDto> {
    let parsed: URL;
    try {
      parsed = new URL(webhookUrl);
    } catch {
      throw new BadRequestException('webhookUrl must be an absolute HTTPS URL');
    }

    if (parsed.protocol !== 'https:') {
      throw new BadRequestException('webhookUrl must be an absolute HTTPS URL');
    }

    const ciphertext = await this.repo.getWebhookSecretCiphertext(clinicId);
    if (ciphertext === null) {
      throw new BadRequestException('Configure a webhook secret first.');
    }

    const secret = this.encryption.decrypt(ciphertext);

    const leadId = `test_${Date.now()}`;
    const now = new Date().toISOString();
    const payload = {
      event_type: 'lead.created',
      lead_id: leadId,
      lead_source: 'medalign',
      received_at: now,
      patient_first_name: 'Test',
      patient_email: 'test@getmedalign.com',
      patient_phone: null,
      patient_dob: null,
      patient_zip: '00000',
      treatment_category: 'hormone',
      top_goals: ['Boost energy & vitality'],
      top_symptoms: ['Persistent fatigue'],
      budget_band: '500_1k',
      telehealth_preference: 'either',
      appointment_preference: 'am',
      start_timeline: 'asap',
      inquiry_message: null,
    };

    const result = await this.webhookSender.send(webhookUrl, payload, secret);

    return {
      lead_id: leadId,
      attempted_at: new Date().toISOString(),
      status: result.ok ? 'success' : 'failed',
      http_status_code: result.status ?? null,
      error_message: result.ok
        ? null
        : (result.error ?? `Endpoint returned HTTP ${result.status ?? 'unknown'}`),
    };
  }
}

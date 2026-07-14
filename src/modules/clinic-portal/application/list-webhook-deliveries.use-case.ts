import { Injectable, Inject } from '@nestjs/common';
import { CLINIC_WEBHOOK_REPOSITORY } from '../domain/ports/clinic-webhook-repository.port';
import type {
  ClinicWebhookRepositoryPort,
  WebhookDeliveryDto,
} from '../domain/ports/clinic-webhook-repository.port';

@Injectable()
export class ListWebhookDeliveriesUseCase {
  constructor(
    @Inject(CLINIC_WEBHOOK_REPOSITORY)
    private readonly repo: ClinicWebhookRepositoryPort,
  ) {}

  async execute(clinicId: string): Promise<WebhookDeliveryDto[]> {
    return this.repo.listWebhookDeliveries(clinicId);
  }
}

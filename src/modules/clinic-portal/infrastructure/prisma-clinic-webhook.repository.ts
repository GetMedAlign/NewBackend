import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  ClinicWebhookRepositoryPort,
  WebhookDeliveryDto,
} from '../domain/ports/clinic-webhook-repository.port';

type DeliveryRow = {
  leadId: string;
  attemptedAt: Date;
  status: string;
  responseCode: number | null;
  error: string | null;
};

@Injectable()
export class PrismaClinicWebhookRepository implements ClinicWebhookRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async listWebhookDeliveries(clinicId: string): Promise<WebhookDeliveryDto[]> {
    return this.prisma.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId },
      async (tx) => {
        const rows = await tx.$queryRaw<DeliveryRow[]>`
          SELECT
            l.lead_id        AS "leadId",
            wd.attempted_at  AS "attemptedAt",
            wd.status,
            wd.response_code AS "responseCode",
            wd.error
          FROM webhook_deliveries wd
          JOIN leads l ON l.id = wd.lead_id
          WHERE l.clinic_id = ${clinicId}::uuid
          ORDER BY wd.attempted_at DESC
          LIMIT 50
        `;
        return rows.map((row) => ({
          lead_id: row.leadId,
          attempted_at: row.attemptedAt.toISOString(),
          status: row.status,
          http_status_code: row.responseCode ?? null,
          error_message: row.error ?? null,
        }));
      },
    );
  }

  async rotateWebhookSecret(clinicId: string, encryptedSecret: string): Promise<void> {
    await this.prisma.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId },
      (tx) =>
        tx.$executeRaw`
          UPDATE clinics SET webhook_secret = ${encryptedSecret} WHERE id = ${clinicId}::uuid
        `,
    );
  }

  async getWebhookSecretCiphertext(clinicId: string): Promise<string | null> {
    const rows = await this.prisma.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId },
      (tx) =>
        tx.$queryRaw<{ webhookSecret: string | null }[]>`
          SELECT webhook_secret AS "webhookSecret" FROM clinics WHERE id = ${clinicId}::uuid
        `,
    );
    return rows[0]?.webhookSecret ?? null;
  }
}

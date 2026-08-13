import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  SchedulingRepositoryPort,
  SchedulingStateRecord,
  SetCalendlyConnectionInput,
  WebhookVerificationState,
} from '../domain/ports/scheduling-repository.port';

type StateRow = {
  provider: 'none' | 'calendly';
  schedulingUrl: string | null;
  accessTokenEncrypted: string | null;
  webhookUri: string | null;
};

type WebhookVerificationRow = {
  provider: 'none' | 'calendly';
  signingKeyEncrypted: string | null;
};

@Injectable()
export class PrismaSchedulingRepository implements SchedulingRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async getSchedulingState(clinicId: string): Promise<SchedulingStateRecord> {
    const rows = await this.prisma.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId },
      (tx) =>
        tx.$queryRaw<StateRow[]>`
          SELECT
            scheduling_provider              AS "provider",
            calendly_scheduling_url          AS "schedulingUrl",
            calendly_access_token_encrypted  AS "accessTokenEncrypted",
            calendly_webhook_uri             AS "webhookUri"
          FROM clinics
          WHERE id = ${clinicId}::uuid
        `,
    );

    const row = rows[0];
    if (!row) {
      return {
        provider: 'none',
        schedulingUrl: null,
        accessTokenEncrypted: null,
        webhookUri: null,
      };
    }
    return row;
  }

  async setCalendlyConnection(clinicId: string, input: SetCalendlyConnectionInput): Promise<void> {
    await this.prisma.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId },
      (tx) =>
        tx.$executeRaw`
          UPDATE clinics SET
            scheduling_provider = 'calendly',
            calendly_user_uri = ${input.userUri},
            calendly_org_uri = ${input.orgUri},
            calendly_scheduling_url = ${input.schedulingUrl},
            calendly_access_token_encrypted = ${input.accessTokenEncrypted},
            calendly_refresh_token_encrypted = ${input.refreshTokenEncrypted},
            calendly_token_expires_at = ${input.tokenExpiresAt},
            calendly_webhook_uri = ${input.webhookUri},
            calendly_webhook_signing_key_encrypted = ${input.signingKeyEncrypted}
          WHERE id = ${clinicId}::uuid
        `,
    );
  }

  async clearScheduling(clinicId: string): Promise<void> {
    await this.prisma.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId },
      (tx) =>
        tx.$executeRaw`
          UPDATE clinics SET
            scheduling_provider = 'none',
            calendly_user_uri = NULL,
            calendly_org_uri = NULL,
            calendly_scheduling_url = NULL,
            calendly_access_token_encrypted = NULL,
            calendly_refresh_token_encrypted = NULL,
            calendly_token_expires_at = NULL,
            calendly_webhook_uri = NULL,
            calendly_webhook_signing_key_encrypted = NULL
          WHERE id = ${clinicId}::uuid
        `,
    );
  }

  async getWebhookVerificationState(clinicId: string): Promise<WebhookVerificationState> {
    // System-scoped: the inbound webhook request carries no clinic session,
    // only the clinicId path segment, so this can't run through
    // withUserContext's clinic-role RLS the way getSchedulingState does.
    const rows = await this.prisma.asSystem(
      (client) =>
        client.$queryRaw<WebhookVerificationRow[]>`
          SELECT
            scheduling_provider                    AS "provider",
            calendly_webhook_signing_key_encrypted  AS "signingKeyEncrypted"
          FROM clinics
          WHERE id = ${clinicId}::uuid
        `,
    );

    const row = rows[0];
    if (!row) {
      return { provider: 'none', signingKeyEncrypted: null };
    }
    return row;
  }
}

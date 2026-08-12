import { Inject, Injectable, Logger } from '@nestjs/common';
import { CALENDLY_PORT } from '../domain/ports/calendly.port';
import type { CalendlyPort } from '../domain/ports/calendly.port';
import { ENCRYPTION_PORT } from '../../auth/domain/ports/encryption.port';
import type { EncryptionPort } from '../../auth/domain/ports/encryption.port';
import { SCHEDULING_REPOSITORY } from '../domain/ports/scheduling-repository.port';
import type { SchedulingRepositoryPort } from '../domain/ports/scheduling-repository.port';

export type DisconnectSchedulingResult = {
  connected: false;
};

/**
 * Disconnects the clinic's scheduling provider. Deleting the remote Calendly
 * webhook subscription is best-effort: if it fails (expired token, Calendly
 * outage, already-deleted subscription) we log and still clear the local
 * connection, so the clinic is never stuck "connected" because of a remote
 * error it can't fix from the portal.
 */
@Injectable()
export class DisconnectSchedulingUseCase {
  private readonly logger = new Logger(DisconnectSchedulingUseCase.name);

  constructor(
    @Inject(CALENDLY_PORT)
    private readonly calendly: CalendlyPort,
    @Inject(ENCRYPTION_PORT)
    private readonly encryption: EncryptionPort,
    @Inject(SCHEDULING_REPOSITORY)
    private readonly repo: SchedulingRepositoryPort,
  ) {}

  async execute(clinicId: string): Promise<DisconnectSchedulingResult> {
    const state = await this.repo.getSchedulingState(clinicId);

    if (state.provider !== 'none' && state.accessTokenEncrypted && state.webhookUri) {
      try {
        const accessToken = this.encryption.decrypt(state.accessTokenEncrypted);
        await this.calendly.deleteWebhookSubscription(accessToken, state.webhookUri);
      } catch (err) {
        this.logger.warn(
          `Failed to delete Calendly webhook subscription for clinic ${clinicId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    await this.repo.clearScheduling(clinicId);
    return { connected: false };
  }
}

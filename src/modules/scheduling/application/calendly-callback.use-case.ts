import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { CALENDLY_PORT } from '../domain/ports/calendly.port';
import type { CalendlyPort } from '../domain/ports/calendly.port';
import { ENCRYPTION_PORT } from '../../auth/domain/ports/encryption.port';
import type { EncryptionPort } from '../../auth/domain/ports/encryption.port';
import { SCHEDULING_REPOSITORY } from '../domain/ports/scheduling-repository.port';
import type { SchedulingRepositoryPort } from '../domain/ports/scheduling-repository.port';

export type CalendlyCallbackResult = {
  connected: true;
  schedulingUrl: string;
};

/**
 * Completes the Calendly OAuth flow: verifies `state` was minted for this
 * clinic, exchanges the code for tokens, fetches the connected user/org,
 * creates a webhook subscription, and persists everything (encrypted) in a
 * single repository call.
 *
 * Nothing is written to the repository until every Calendly call has
 * succeeded, so a failure at any step (bad code, network error, webhook
 * creation failure) leaves the clinic's scheduling state untouched: no
 * partial connection is ever persisted.
 */
@Injectable()
export class CalendlyCallbackUseCase {
  constructor(
    @Inject(CALENDLY_PORT)
    private readonly calendly: CalendlyPort,
    @Inject(ENCRYPTION_PORT)
    private readonly encryption: EncryptionPort,
    @Inject(SCHEDULING_REPOSITORY)
    private readonly repo: SchedulingRepositoryPort,
  ) {}

  async execute(clinicId: string, code: string, state: string): Promise<CalendlyCallbackResult> {
    this.assertStateMatchesClinic(clinicId, state);

    const tokens = await this.calendly.exchangeCode(code);
    const me = await this.calendly.getMe(tokens.accessToken);

    const signingKey = randomBytes(32).toString('hex');
    const webhook = await this.calendly.createWebhookSubscription(
      tokens.accessToken,
      me.orgUri,
      signingKey,
    );

    await this.repo.setCalendlyConnection(clinicId, {
      userUri: me.userUri,
      orgUri: me.orgUri,
      schedulingUrl: me.schedulingUrl,
      accessTokenEncrypted: this.encryption.encrypt(tokens.accessToken),
      refreshTokenEncrypted: this.encryption.encrypt(tokens.refreshToken),
      tokenExpiresAt: tokens.expiresAt,
      webhookUri: webhook.webhookUri,
      signingKeyEncrypted: this.encryption.encrypt(signingKey),
    });

    return { connected: true, schedulingUrl: me.schedulingUrl };
  }

  /** Decrypts `state` and throws unless it was minted for `clinicId`. */
  private assertStateMatchesClinic(clinicId: string, state: string): void {
    let plaintext: string;
    try {
      plaintext = this.encryption.decrypt(state);
    } catch {
      throw new BadRequestException('Invalid or expired state');
    }

    const separatorIndex = plaintext.indexOf(':');
    if (separatorIndex === -1) {
      throw new BadRequestException('Invalid state format');
    }

    const stateClinicId = plaintext.slice(0, separatorIndex);
    if (stateClinicId !== clinicId) {
      throw new ForbiddenException('State does not match the authenticated clinic');
    }
  }
}

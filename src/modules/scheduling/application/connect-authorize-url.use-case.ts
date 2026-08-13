import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CALENDLY_PORT } from '../domain/ports/calendly.port';
import type { CalendlyPort } from '../domain/ports/calendly.port';
import { ENCRYPTION_PORT } from '../../auth/domain/ports/encryption.port';
import type { EncryptionPort } from '../../auth/domain/ports/encryption.port';

export type AuthorizeUrlResult = {
  authorizeUrl: string;
};

/**
 * Builds the Calendly OAuth authorize URL for a clinic. The `state` value
 * binds the request to the authenticated clinic: it is `clinicId:nonce`
 * encrypted with the same AES-GCM key used for other clinic secrets, so the
 * callback can decrypt it and verify the clinicId matches the caller without
 * needing a separate state store.
 */
@Injectable()
export class ConnectAuthorizeUrlUseCase {
  constructor(
    @Inject(CALENDLY_PORT)
    private readonly calendly: CalendlyPort,
    @Inject(ENCRYPTION_PORT)
    private readonly encryption: EncryptionPort,
  ) {}

  execute(clinicId: string): AuthorizeUrlResult {
    const nonce = randomUUID();
    const state = this.encryption.encrypt(`${clinicId}:${nonce}`);
    const authorizeUrl = this.calendly.buildAuthorizeUrl(state);
    return { authorizeUrl };
  }
}

export type SchedulingProvider = 'none' | 'calendly';

/**
 * Raw scheduling connection state for a clinic. Includes the encrypted
 * access token and webhook URI needed internally to disconnect the
 * integration: callers that expose this to the client (status endpoints,
 * DTOs) MUST strip those two fields and never return ciphertext.
 */
export type SchedulingStateRecord = {
  provider: SchedulingProvider;
  schedulingUrl: string | null;
  /** Raw AES-GCM ciphertext from `calendly_access_token_encrypted`. Never decrypted here. */
  accessTokenEncrypted: string | null;
  /** Calendly webhook subscription URI, needed to delete it on disconnect. */
  webhookUri: string | null;
};

export type SetCalendlyConnectionInput = {
  userUri: string;
  orgUri: string;
  schedulingUrl: string;
  /** Raw AES-GCM ciphertext, already encrypted by the caller. */
  accessTokenEncrypted: string;
  /** Raw AES-GCM ciphertext, already encrypted by the caller. */
  refreshTokenEncrypted: string;
  tokenExpiresAt: Date;
  webhookUri: string;
  /** Raw AES-GCM ciphertext, already encrypted by the caller. */
  signingKeyEncrypted: string;
};

/**
 * The minimal state the webhook receiver needs to verify an inbound
 * Calendly delivery: whether the clinic is connected, and the encrypted
 * signing key to check the signature against. Deliberately excludes every
 * other scheduling field (access token, webhook URI, etc.); this MUST
 * never be exposed on any DTO.
 */
export type WebhookVerificationState = {
  provider: SchedulingProvider;
  /** Raw AES-GCM ciphertext from `calendly_webhook_signing_key_encrypted`. Never decrypted here. */
  signingKeyEncrypted: string | null;
};

export interface SchedulingRepositoryPort {
  /** Returns the current scheduling state for a clinic, defaulting to disconnected. */
  getSchedulingState(clinicId: string): Promise<SchedulingStateRecord>;

  /** Persists a completed Calendly connection and sets scheduling_provider = 'calendly'. */
  setCalendlyConnection(clinicId: string, input: SetCalendlyConnectionInput): Promise<void>;

  /** Resets scheduling_provider to 'none' and nulls out every Calendly field. */
  clearScheduling(clinicId: string): Promise<void>;

  /**
   * Returns just enough state to verify a webhook delivery for a clinic
   * (provider + encrypted signing key), system-scoped (`asSystem`) since the
   * webhook request carries no clinic session. Defaults to `{ provider:
   * 'none', signingKeyEncrypted: null }` for an unknown clinic id.
   */
  getWebhookVerificationState(clinicId: string): Promise<WebhookVerificationState>;
}

export const SCHEDULING_REPOSITORY = Symbol('SchedulingRepositoryPort');

export interface CalendlyWebhookVerifierPort {
  /** Throws when the signature header is missing, malformed, stale, or does not match the body. */
  verify(rawBody: Buffer, signatureHeader: string, signingKey: string): void;
}

export const CALENDLY_WEBHOOK_VERIFIER = Symbol('CalendlyWebhookVerifier');

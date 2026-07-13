export interface WebhookSendResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export interface WebhookSenderPort {
  /**
   * POSTs the JSON `payload` to `url`, signing the body with an
   * `X-MedAlign-Signature: sha256=<hex HMAC-SHA256(body, secret)>` header.
   * Implementations MUST guard against SSRF. Never throws — failures are
   * returned as `{ ok: false, error }`.
   */
  send(url: string, payload: object, secret: string): Promise<WebhookSendResult>;
}

export const WEBHOOK_SENDER = Symbol('WebhookSenderPort');

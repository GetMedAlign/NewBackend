export interface CalendlyTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export interface CalendlyPort {
  buildAuthorizeUrl(state: string): string;
  exchangeCode(code: string): Promise<CalendlyTokens>;
  refreshToken(refreshToken: string): Promise<CalendlyTokens>;
  getMe(accessToken: string): Promise<{ userUri: string; orgUri: string; schedulingUrl: string }>;
  createWebhookSubscription(
    accessToken: string,
    orgUri: string,
    signingKey: string,
    clinicId: string,
  ): Promise<{ webhookUri: string }>;
  deleteWebhookSubscription(accessToken: string, webhookUri: string): Promise<void>;
}

export const CALENDLY_PORT = Symbol('CalendlyPort');

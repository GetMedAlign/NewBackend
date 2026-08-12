import { Injectable, InternalServerErrorException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../infrastructure/config/env.schema';
import type { CalendlyPort, CalendlyTokens } from '../domain/ports/calendly.port';

interface CalendlyTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

interface CalendlyMeResponse {
  resource: {
    uri: string;
    current_organization: string;
    scheduling_url: string;
  };
}

interface CalendlyWebhookResponse {
  resource: {
    uri: string;
  };
}

/** Real CalendlyPort backed by global fetch. Used only outside tests. */
@Injectable()
export class CalendlyHttpAdapter implements CalendlyPort {
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly config: ConfigService<Env, true>,
    @Optional() fetchImpl?: typeof fetch,
  ) {
    this.fetchImpl = fetchImpl ?? fetch;
  }

  buildAuthorizeUrl(state: string): string {
    const authBase = this.config.getOrThrow<string>('CALENDLY_AUTH_BASE');
    const params = new URLSearchParams({
      client_id: this.config.getOrThrow<string>('CALENDLY_CLIENT_ID'),
      response_type: 'code',
      redirect_uri: this.config.getOrThrow<string>('CALENDLY_REDIRECT_URI'),
      state,
    });
    return `${authBase}/oauth/authorize?${params.toString()}`;
  }

  exchangeCode(code: string): Promise<CalendlyTokens> {
    return this.requestToken({
      grant_type: 'authorization_code',
      client_id: this.config.getOrThrow<string>('CALENDLY_CLIENT_ID'),
      client_secret: this.config.getOrThrow<string>('CALENDLY_CLIENT_SECRET'),
      redirect_uri: this.config.getOrThrow<string>('CALENDLY_REDIRECT_URI'),
      code,
    });
  }

  refreshToken(refreshToken: string): Promise<CalendlyTokens> {
    return this.requestToken({
      grant_type: 'refresh_token',
      client_id: this.config.getOrThrow<string>('CALENDLY_CLIENT_ID'),
      client_secret: this.config.getOrThrow<string>('CALENDLY_CLIENT_SECRET'),
      refresh_token: refreshToken,
    });
  }

  async getMe(
    accessToken: string,
  ): Promise<{ userUri: string; orgUri: string; schedulingUrl: string }> {
    const apiBase = this.config.getOrThrow<string>('CALENDLY_API_BASE');
    const response = await this.fetchImpl(`${apiBase}/users/me`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new InternalServerErrorException(`Calendly getMe failed with status ${response.status}`);
    }
    const data = (await response.json()) as CalendlyMeResponse;
    return {
      userUri: data.resource.uri,
      orgUri: data.resource.current_organization,
      schedulingUrl: data.resource.scheduling_url,
    };
  }

  async createWebhookSubscription(
    accessToken: string,
    orgUri: string,
    signingKey: string,
  ): Promise<{ webhookUri: string }> {
    const apiBase = this.config.getOrThrow<string>('CALENDLY_API_BASE');
    const response = await this.fetchImpl(`${apiBase}/webhook_subscriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: this.config.getOrThrow<string>('CALENDLY_WEBHOOK_URL'),
        events: ['invitee.created', 'invitee.canceled'],
        organization: orgUri,
        scope: 'organization',
        signing_key: signingKey,
      }),
    });
    if (!response.ok) {
      throw new InternalServerErrorException(
        `Calendly createWebhookSubscription failed with status ${response.status}`,
      );
    }
    const data = (await response.json()) as CalendlyWebhookResponse;
    return { webhookUri: data.resource.uri };
  }

  async deleteWebhookSubscription(accessToken: string, webhookUri: string): Promise<void> {
    const response = await this.fetchImpl(webhookUri, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new InternalServerErrorException(
        `Calendly deleteWebhookSubscription failed with status ${response.status}`,
      );
    }
  }

  /**
   * Shared POST to the OAuth token endpoint. The request body carries the
   * client secret, so callers only ever get status codes back on failure,
   * never the raw response body.
   */
  private async requestToken(body: Record<string, string>): Promise<CalendlyTokens> {
    const authBase = this.config.getOrThrow<string>('CALENDLY_AUTH_BASE');
    const response = await this.fetchImpl(`${authBase}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new InternalServerErrorException(
        `Calendly token request failed with status ${response.status}`,
      );
    }
    const data = (await response.json()) as CalendlyTokenResponse;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };
  }
}

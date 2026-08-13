import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../../infrastructure/config/env.schema';
import { CalendlyHttpAdapter } from '../calendly.adapter';

const TEST_ENV: Record<string, string> = {
  CALENDLY_CLIENT_ID: 'test-client-id',
  CALENDLY_CLIENT_SECRET: 'test-client-secret',
  CALENDLY_REDIRECT_URI: 'https://app.medalign.test/scheduling/callback',
  CALENDLY_WEBHOOK_URL: 'https://api.medalign.test/scheduling/calendly/webhook',
  CALENDLY_API_BASE: 'https://api.calendly.com',
  CALENDLY_AUTH_BASE: 'https://auth.calendly.com',
};

function makeConfigService(): ConfigService<Env, true> {
  return {
    getOrThrow: (key: string) => {
      const value = TEST_ENV[key];
      if (value === undefined) {
        throw new Error(`Missing test env value for ${key}`);
      }
      return value;
    },
  } as unknown as ConfigService<Env, true>;
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

describe('CalendlyHttpAdapter', () => {
  let fetchMock: jest.Mock;
  let adapter: CalendlyHttpAdapter;

  beforeEach(() => {
    fetchMock = jest.fn();
    adapter = new CalendlyHttpAdapter(makeConfigService(), fetchMock as unknown as typeof fetch);
  });

  describe('buildAuthorizeUrl', () => {
    it('builds the authorize URL with encoded query params', () => {
      const url = adapter.buildAuthorizeUrl('state-123');
      const parsed = new URL(url);

      expect(parsed.origin + parsed.pathname).toBe('https://auth.calendly.com/oauth/authorize');
      expect(parsed.searchParams.get('client_id')).toBe('test-client-id');
      expect(parsed.searchParams.get('response_type')).toBe('code');
      expect(parsed.searchParams.get('redirect_uri')).toBe(
        'https://app.medalign.test/scheduling/callback',
      );
      expect(parsed.searchParams.get('state')).toBe('state-123');
    });
  });

  describe('exchangeCode', () => {
    it('POSTs to the token endpoint with authorization_code grant and maps tokens', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 3600,
        }),
      );

      const tokens = await adapter.exchangeCode('auth-code-1');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://auth.calendly.com/oauth/token');
      expect(init.method).toBe('POST');
      expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
      expect(JSON.parse(init.body)).toEqual({
        grant_type: 'authorization_code',
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
        redirect_uri: 'https://app.medalign.test/scheduling/callback',
        code: 'auth-code-1',
      });

      expect(tokens.accessToken).toBe('access-1');
      expect(tokens.refreshToken).toBe('refresh-1');
      expect(tokens.expiresAt).toBeInstanceOf(Date);
      expect(tokens.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('throws InternalServerErrorException on a non-2xx response', async () => {
      fetchMock.mockResolvedValue(jsonResponse(400, { error: 'invalid_grant' }));

      await expect(adapter.exchangeCode('bad-code')).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });

    it('does not leak the client secret in the thrown error', async () => {
      fetchMock.mockResolvedValue(jsonResponse(401, { error: 'invalid_client' }));

      let caught: unknown;
      try {
        await adapter.exchangeCode('any-code');
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(InternalServerErrorException);
      expect((caught as Error).message).not.toContain('test-client-secret');
    });
  });

  describe('refreshToken', () => {
    it('POSTs to the token endpoint with refresh_token grant and maps tokens', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          access_token: 'access-2',
          refresh_token: 'refresh-2',
          expires_in: 7200,
        }),
      );

      const tokens = await adapter.refreshToken('old-refresh-token');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://auth.calendly.com/oauth/token');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({
        grant_type: 'refresh_token',
        client_id: 'test-client-id',
        client_secret: 'test-client-secret',
        refresh_token: 'old-refresh-token',
      });

      expect(tokens.accessToken).toBe('access-2');
      expect(tokens.refreshToken).toBe('refresh-2');
      expect(tokens.expiresAt).toBeInstanceOf(Date);
    });

    it('throws InternalServerErrorException on a non-2xx response', async () => {
      fetchMock.mockResolvedValue(jsonResponse(500, { error: 'server_error' }));

      await expect(adapter.refreshToken('some-refresh-token')).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });
  });

  describe('getMe', () => {
    it('GETs /users/me with a bearer token and maps the resource', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          resource: {
            uri: 'https://api.calendly.com/users/USER123',
            current_organization: 'https://api.calendly.com/organizations/ORG123',
            scheduling_url: 'https://calendly.com/some-user',
          },
        }),
      );

      const me = await adapter.getMe('access-token-1');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.calendly.com/users/me');
      expect(init.method).toBe('GET');
      expect(init.headers).toMatchObject({ Authorization: 'Bearer access-token-1' });

      expect(me).toEqual({
        userUri: 'https://api.calendly.com/users/USER123',
        orgUri: 'https://api.calendly.com/organizations/ORG123',
        schedulingUrl: 'https://calendly.com/some-user',
      });
    });

    it('throws InternalServerErrorException on a non-2xx response', async () => {
      fetchMock.mockResolvedValue(jsonResponse(401, { error: 'unauthorized' }));

      await expect(adapter.getMe('bad-token')).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });

  describe('createWebhookSubscription', () => {
    it('POSTs to /webhook_subscriptions with the expected payload and maps the response', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(201, {
          resource: { uri: 'https://api.calendly.com/webhook_subscriptions/WH123' },
        }),
      );

      const result = await adapter.createWebhookSubscription(
        'access-token-1',
        'https://api.calendly.com/organizations/ORG123',
        'signing-key-1',
        'clinic-123',
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.calendly.com/webhook_subscriptions');
      expect(init.method).toBe('POST');
      expect(init.headers).toMatchObject({
        Authorization: 'Bearer access-token-1',
        'Content-Type': 'application/json',
      });
      expect(JSON.parse(init.body)).toEqual({
        url: 'https://api.medalign.test/scheduling/calendly/webhook/clinic-123',
        events: ['invitee.created', 'invitee.canceled'],
        organization: 'https://api.calendly.com/organizations/ORG123',
        scope: 'organization',
        signing_key: 'signing-key-1',
      });

      expect(result).toEqual({
        webhookUri: 'https://api.calendly.com/webhook_subscriptions/WH123',
      });
    });

    it('builds the per-clinic URL without a double slash when the base URL has a trailing slash', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(201, {
          resource: { uri: 'https://api.calendly.com/webhook_subscriptions/WH123' },
        }),
      );
      const trailingSlashConfig = makeConfigService();
      const adapterWithTrailingSlash = new CalendlyHttpAdapter(
        {
          getOrThrow: (key: string) => {
            if (key === 'CALENDLY_WEBHOOK_URL') {
              return 'https://api.medalign.test/scheduling/calendly/webhook/';
            }
            return trailingSlashConfig.getOrThrow(key as never);
          },
        } as unknown as ConfigService<Env, true>,
        fetchMock as unknown as typeof fetch,
      );

      await adapterWithTrailingSlash.createWebhookSubscription(
        'access-token-1',
        'https://api.calendly.com/organizations/ORG123',
        'signing-key-1',
        'clinic-123',
      );

      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init.body).url).toBe(
        'https://api.medalign.test/scheduling/calendly/webhook/clinic-123',
      );
    });

    it('throws InternalServerErrorException on a non-2xx response', async () => {
      fetchMock.mockResolvedValue(jsonResponse(422, { error: 'invalid' }));

      await expect(
        adapter.createWebhookSubscription('access-token-1', 'org-uri', 'signing-key', 'clinic-123'),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });

  describe('deleteWebhookSubscription', () => {
    it('DELETEs the webhook URI with a bearer token', async () => {
      fetchMock.mockResolvedValue(jsonResponse(204, {}));

      await adapter.deleteWebhookSubscription(
        'access-token-1',
        'https://api.calendly.com/webhook_subscriptions/WH123',
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.calendly.com/webhook_subscriptions/WH123');
      expect(init.method).toBe('DELETE');
      expect(init.headers).toMatchObject({ Authorization: 'Bearer access-token-1' });
    });

    it('throws InternalServerErrorException on a non-2xx response', async () => {
      fetchMock.mockResolvedValue(jsonResponse(404, { error: 'not_found' }));

      await expect(
        adapter.deleteWebhookSubscription(
          'access-token-1',
          'https://api.calendly.com/webhook_subscriptions/WH123',
        ),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });
});

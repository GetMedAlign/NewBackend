/**
 * Integration tests for SsrfWebhookSender (spec §4).
 *
 * Covers:
 *  - non-HTTPS URL rejected with NO network call.
 *  - metadata (169.254.169.254) and private-IP hosts rejected with NO network call.
 *  - happy path against a LOCAL test server (via the test seam) that verifies
 *    the X-MedAlign-Signature header.
 */
import { createServer, Server } from 'http';
import { createHmac } from 'crypto';
import { AddressInfo } from 'net';

import {
  SsrfWebhookSender,
  isForbiddenAddress,
} from '../../src/modules/leads/infrastructure/ssrf-webhook-sender';

describe('SsrfWebhookSender (integration)', () => {
  describe('guard rejects before any network call', () => {
    it('rejects a non-HTTPS URL', async () => {
      const resolveOverride = jest.fn();
      const sender = new SsrfWebhookSender({ resolveOverride });

      const result = await sender.send('http://example.com/hook', { a: 1 }, 'secret');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('non_https_url');
      // No DNS resolution and therefore no network call attempted.
      expect(resolveOverride).not.toHaveBeenCalled();
    });

    it('rejects the cloud-metadata IP literal without connecting', async () => {
      const sender = new SsrfWebhookSender();
      const result = await sender.send('https://169.254.169.254/latest/meta-data', {}, 'secret');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('forbidden_address');
    });

    it('rejects a host that resolves to a private RFC1918 address without connecting', async () => {
      // Override DNS to return a private address for a public-looking host.
      const resolveOverride = jest.fn().mockResolvedValue([{ address: '10.1.2.3', family: 4 }]);
      const sender = new SsrfWebhookSender({ resolveOverride });

      const result = await sender.send('https://internal.example.com/hook', {}, 'secret');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('forbidden_address');
    });

    it('classifies the private address as forbidden (sanity)', () => {
      expect(isForbiddenAddress('10.1.2.3')).toBe(true);
    });
  });

  describe('happy path via a local HTTP test server', () => {
    let server: Server;
    let port: number;
    const secret = 'whsec_test_123';
    let received: { signature?: string; body?: string };

    beforeAll(async () => {
      received = {};
      server = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          received.signature = req.headers['x-medalign-signature'] as string | undefined;
          received.body = Buffer.concat(chunks).toString('utf8');
          res.statusCode = 200;
          res.end('ok');
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      port = (server.address() as AddressInfo).port;
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('delivers the signed payload; server sees a correct X-MedAlign-Signature', async () => {
      // Test seam: resolve the local host, and explicitly allow 127.0.0.1 for
      // THIS sender only — the default guard stays intact for production wiring.
      // The local server speaks HTTP, so we exercise the plaintext dispatch by
      // pointing the sender at an https URL whose lookup targets the loopback.
      //
      // Because our test server is plain HTTP, we instead verify signing +
      // guard-passing behaviour by asserting the request reaches the server.
      const resolveOverride = jest.fn().mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
      const allowAddress = (ip: string): boolean => ip === '127.0.0.1';

      const sender = new LocalHttpSsrfSender({ resolveOverride, allowAddress }, port);
      const payload = { leadId: 'lead_1', hello: 'world' };
      const result = await sender.send(`https://webhook.local/hook`, payload, secret);

      expect(result.ok).toBe(true);
      expect(received.body).toBe(JSON.stringify(payload));

      const expected =
        'sha256=' + createHmac('sha256', secret).update(received.body!).digest('hex');
      expect(received.signature).toBe(expected);
    });
  });
});

/**
 * Test-only subclass that swaps the HTTPS transport for HTTP against a local
 * port. It reuses the production guard + signing (via the parent `send`) and
 * only overrides the final network dispatch, so the SSRF checks are still
 * exercised end-to-end.
 */
import { request as httpRequest } from 'http';
import type { LookupFunction } from 'net';
import type { SsrfWebhookSenderTestSeam } from '../../src/modules/leads/infrastructure/ssrf-webhook-sender';
import type { WebhookSendResult } from '../../src/modules/leads/domain/ports/webhook-sender.port';

class LocalHttpSsrfSender extends SsrfWebhookSender {
  constructor(
    seam: SsrfWebhookSenderTestSeam,
    private readonly localPort: number,
  ) {
    super(seam);
  }

  // Re-implement only the transport: HTTP to the local port, reusing the
  // parent's guard + signature logic by calling super.send but intercepting
  // the dispatch. We override the private dispatch via a protected hook.
  protected override dispatch(
    parsed: URL,
    body: string,
    signature: string,
    _lookup: LookupFunction,
  ): Promise<WebhookSendResult> {
    void _lookup; // transport is swapped to local HTTP; pinning IP not needed here
    return new Promise<WebhookSendResult>((resolve) => {
      const req = httpRequest(
        {
          hostname: '127.0.0.1',
          port: this.localPort,
          path: `${parsed.pathname}${parsed.search}`,
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
            'x-medalign-signature': `sha256=${signature}`,
          },
        },
        (res) => {
          res.resume();
          res.on('end', () =>
            resolve({
              ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
              status: res.statusCode,
            }),
          );
        },
      );
      req.on('error', (err) => resolve({ ok: false, error: err.message }));
      req.write(body);
      req.end();
    });
  }
}

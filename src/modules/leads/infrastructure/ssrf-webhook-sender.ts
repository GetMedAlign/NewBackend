import { Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';
import { request as httpsRequest } from 'https';
import type { LookupFunction } from 'net';
import { isIP } from 'net';
import { lookup as dnsLookup } from 'dns';
import { promisify } from 'util';

import type { WebhookSenderPort, WebhookSendResult } from '../domain/ports/webhook-sender.port';

const REQUEST_TIMEOUT_MS = 10_000;

/** Promisified DNS resolver returning ALL A/AAAA records for a host. */
const resolveAll = promisify(dnsLookup) as (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<{ address: string; family: number }[]>;

/**
 * Parses an IPv4 dotted-quad into its 32-bit unsigned integer, or null if it
 * is not a valid IPv4 literal.
 */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

function inV4Cidr(ipInt: number, base: string, prefix: number): boolean {
  const baseInt = ipv4ToInt(base);
  if (baseInt === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

/**
 * Returns true for any address that must never be the target of an outbound
 * webhook: loopback, RFC1918 private, link-local (incl. the 169.254.169.254
 * cloud metadata endpoint), IPv6 ULA/link-local, and other non-public ranges.
 *
 * Pure and side-effect free so it can be exhaustively unit-tested.
 */
export function isForbiddenAddress(ip: string): boolean {
  const family = isIP(ip);

  if (family === 4) {
    return isForbiddenV4(ip);
  }

  if (family === 6) {
    return isForbiddenV6(ip);
  }

  // Not a parseable IP literal — treat as forbidden (fail closed).
  return true;
}

function isForbiddenV4(ip: string): boolean {
  const ipInt = ipv4ToInt(ip);
  if (ipInt === null) return true;

  const forbidden: [string, number][] = [
    ['0.0.0.0', 8], // "this" network / unspecified
    ['10.0.0.0', 8], // RFC1918 private
    ['100.64.0.0', 10], // carrier-grade NAT
    ['127.0.0.0', 8], // loopback
    ['169.254.0.0', 16], // link-local (incl. cloud metadata 169.254.169.254)
    ['172.16.0.0', 12], // RFC1918 private
    ['192.0.0.0', 24], // IETF protocol assignments
    ['192.0.2.0', 24], // TEST-NET-1
    ['192.168.0.0', 16], // RFC1918 private
    ['198.18.0.0', 15], // benchmarking
    ['198.51.100.0', 24], // TEST-NET-2
    ['203.0.113.0', 24], // TEST-NET-3
    ['224.0.0.0', 4], // multicast
    ['240.0.0.0', 4], // reserved (incl. 255.255.255.255 broadcast)
  ];

  return forbidden.some(([base, prefix]) => inV4Cidr(ipInt, base, prefix));
}

function isForbiddenV6(ip: string): boolean {
  const normalized = ip.toLowerCase().split('%')[0]; // strip zone id

  // Unspecified / loopback.
  if (normalized === '::' || normalized === '::1') return true;

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible — validate the embedded v4.
  const mapped = normalized.match(/^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) {
    return isForbiddenV4(mapped[1]);
  }

  const firstHextet = normalized.split(':')[0];
  const head = parseInt(firstHextet || '0', 16);

  // fe80::/10 link-local.
  if ((head & 0xffc0) === 0xfe80) return true;
  // fc00::/7 unique-local (fd00::/8 and fc00::/8).
  if ((head & 0xfe00) === 0xfc00) return true;
  // ff00::/8 multicast.
  if ((head & 0xff00) === 0xff00) return true;

  return false;
}

/**
 * Options that widen the guard for TESTING ONLY. Never construct the provider
 * with these in production wiring — the DI token binds the no-arg constructor.
 */
export interface SsrfWebhookSenderTestSeam {
  /**
   * Overrides DNS resolution. Used by integration tests to point a
   * public-looking hostname at a local test server WITHOUT weakening the
   * default address guard. When set, the returned addresses still pass through
   * `isForbiddenAddress` unless `allowAddress` also permits them.
   */
  resolveOverride?: (hostname: string) => Promise<{ address: string; family: number }[]>;
  /**
   * Predicate consulted IN ADDITION to `isForbiddenAddress` to permit an
   * otherwise-forbidden address (e.g. 127.0.0.1 for a local test server).
   * The default guard is never weakened for non-test callers.
   */
  allowAddress?: (ip: string) => boolean;
}

@Injectable()
export class SsrfWebhookSender implements WebhookSenderPort {
  constructor(private readonly seam: SsrfWebhookSenderTestSeam = {}) {}

  async send(url: string, payload: object, secret: string): Promise<WebhookSendResult> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, error: 'invalid_url' };
    }

    // Require an absolute HTTPS URL — no network call otherwise.
    if (parsed.protocol !== 'https:') {
      return { ok: false, error: 'non_https_url' };
    }

    const hostname = parsed.hostname;

    let addresses: { address: string; family: number }[];
    try {
      addresses = this.seam.resolveOverride
        ? await this.seam.resolveOverride(hostname)
        : await resolveAll(hostname, { all: true, verbatim: true });
    } catch {
      return { ok: false, error: 'dns_resolution_failed' };
    }

    if (addresses.length === 0) {
      return { ok: false, error: 'dns_resolution_failed' };
    }

    // Reject if ANY resolved address is forbidden (unless the test seam allows
    // it). Rejecting on any (rather than all) prevents a rebinding attacker
    // from mixing a public and a private answer.
    for (const { address } of addresses) {
      if (isForbiddenAddress(address) && !this.seam.allowAddress?.(address)) {
        return { ok: false, error: 'forbidden_address' };
      }
    }

    // Pin the connection to a validated resolved address. The custom lookup
    // returns the pre-validated IP so DNS cannot be re-resolved (and rebound)
    // between the check above and the actual connect. The Host header and TLS
    // servername stay the original hostname.
    const pinned = addresses[0];
    const lookup: LookupFunction = (_host, _opts, cb): void => {
      cb(null, pinned.address, pinned.family);
    };

    const body = JSON.stringify(payload);
    const signature = createHmac('sha256', secret).update(body).digest('hex');

    return this.dispatch(parsed, body, signature, lookup);
  }

  /**
   * Performs the actual signed HTTPS POST with the connection pinned to the
   * pre-validated IP via `lookup`. `protected` so integration tests can swap
   * the transport (e.g. to a local HTTP server) WITHOUT weakening the guard.
   */
  protected dispatch(
    parsed: URL,
    body: string,
    signature: string,
    lookup: LookupFunction,
  ): Promise<WebhookSendResult> {
    return new Promise<WebhookSendResult>((resolve) => {
      let settled = false;
      const finish = (result: WebhookSendResult): void => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      const req = httpsRequest(
        {
          protocol: parsed.protocol,
          hostname: parsed.hostname,
          port: parsed.port || 443,
          path: `${parsed.pathname}${parsed.search}`,
          method: 'POST',
          servername: parsed.hostname,
          lookup,
          timeout: REQUEST_TIMEOUT_MS,
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
            'x-medalign-signature': `sha256=${signature}`,
          },
        },
        (res) => {
          const status = res.statusCode ?? 0;
          // Disable redirect following: any 3xx is treated as a failure so a
          // redirect cannot bounce us to an internal address.
          if (status >= 300 && status < 400) {
            res.resume();
            finish({ ok: false, status, error: 'redirect_not_allowed' });
            return;
          }
          res.resume(); // drain
          res.on('end', () => {
            finish({ ok: status >= 200 && status < 300, status });
          });
        },
      );

      req.on('error', (err: Error) => {
        finish({ ok: false, error: err.message });
      });
      req.on('timeout', () => {
        req.destroy();
        finish({ ok: false, error: 'timeout' });
      });

      req.write(body);
      req.end();
    });
  }
}

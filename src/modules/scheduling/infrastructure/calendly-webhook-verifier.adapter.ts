import { BadRequestException, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import type { CalendlyWebhookVerifierPort } from '../domain/ports/calendly-webhook-verifier.port';

const TOLERANCE_SECONDS = 300;

/**
 * Verifies the `Calendly-Webhook-Signature` header: `t=<unixSeconds>,v1=<hexHmac>`.
 * The signed payload is `${t}.${rawBody}`, HMAC-SHA256 with the clinic's signing key.
 */
@Injectable()
export class CalendlyWebhookVerifierAdapter implements CalendlyWebhookVerifierPort {
  verify(rawBody: Buffer, signatureHeader: string, signingKey: string): void {
    const { timestamp, signature } = this.parseHeader(signatureHeader);

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - timestamp) > TOLERANCE_SECONDS) {
      throw new BadRequestException('Calendly webhook signature timestamp is stale');
    }

    const expectedSignature = createHmac('sha256', signingKey)
      .update(`${timestamp}.${rawBody.toString('utf8')}`)
      .digest('hex');

    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    const actualBuffer = Buffer.from(signature, 'hex');
    if (
      expectedBuffer.length !== actualBuffer.length ||
      !timingSafeEqual(expectedBuffer, actualBuffer)
    ) {
      throw new BadRequestException('Calendly webhook signature does not match');
    }
  }

  private parseHeader(signatureHeader: string): { timestamp: number; signature: string } {
    if (!signatureHeader) {
      throw new BadRequestException('Missing Calendly webhook signature header');
    }

    const parts: Record<string, string> = {};
    for (const segment of signatureHeader.split(',')) {
      const [key, value] = segment.split('=');
      if (key && value) {
        parts[key.trim()] = value.trim();
      }
    }

    const timestampRaw = parts['t'];
    const signature = parts['v1'];
    if (!timestampRaw || !signature) {
      throw new BadRequestException('Malformed Calendly webhook signature header');
    }

    const timestamp = Number(timestampRaw);
    if (!Number.isFinite(timestamp)) {
      throw new BadRequestException('Malformed Calendly webhook signature timestamp');
    }

    if (!/^[0-9a-f]+$/i.test(signature) || signature.length % 2 !== 0) {
      throw new BadRequestException('Malformed Calendly webhook signature value');
    }

    return { timestamp, signature };
  }
}

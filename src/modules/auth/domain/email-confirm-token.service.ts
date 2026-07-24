import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Deterministic email-confirmation token: HMAC-SHA256 of the email address,
 * namespaced so it can never collide with the assessment claim token that
 * shares the same secret. It proves the recipient received the confirmation
 * email; it is intentionally stateless (no table/migration) and low-sensitivity
 * (it only flips email_confirmed).
 */
@Injectable()
export class EmailConfirmTokenService {
  constructor(private readonly config: ConfigService) {}

  issue(email: string): string {
    const secret = this.config.getOrThrow<string>('CLAIM_TOKEN_SECRET');
    return createHmac('sha256', secret)
      .update(`email-confirm:${email.toLowerCase()}`)
      .digest('base64url');
  }

  verify(email: string, token: string): boolean {
    const expected = Buffer.from(this.issue(email));
    const provided = Buffer.from(token);
    return expected.length === provided.length && timingSafeEqual(expected, provided);
  }
}

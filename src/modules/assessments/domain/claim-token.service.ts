import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Env } from '../../../infrastructure/config/env.schema';

@Injectable()
export class ClaimTokenService {
  constructor(private readonly configService: ConfigService<Env, true>) {}

  issue(sessionId: string): string {
    const secret = this.configService.getOrThrow<string>('CLAIM_TOKEN_SECRET');
    return createHmac('sha256', secret).update(sessionId).digest('base64url');
  }

  verify(sessionId: string, token: string): boolean {
    if (!token) {
      return false;
    }

    const expected = this.issue(sessionId);

    const expectedBuf = Buffer.from(expected, 'utf8');
    const providedBuf = Buffer.from(token, 'utf8');

    if (expectedBuf.length !== providedBuf.length) {
      return false;
    }

    return timingSafeEqual(expectedBuf, providedBuf);
  }
}

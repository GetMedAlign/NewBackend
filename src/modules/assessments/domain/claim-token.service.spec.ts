import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../infrastructure/config/env.schema';
import { ClaimTokenService } from './claim-token.service';

const TEST_SECRET = 'test-claim-token-secret-at-least-32-chars!!';

function makeService(secret = TEST_SECRET): ClaimTokenService {
  const configService = {
    getOrThrow: () => secret,
  } as unknown as ConfigService<Env, true>;

  return new ClaimTokenService(configService);
}

describe('ClaimTokenService', () => {
  let service: ClaimTokenService;

  beforeEach(() => {
    service = makeService();
  });

  describe('issue', () => {
    it('returns the same token for the same sessionId (deterministic)', () => {
      const sid = 'session_abc123';
      expect(service.issue(sid)).toBe(service.issue(sid));
    });

    it('returns different tokens for different sessionIds', () => {
      const token1 = service.issue('session_aaaa');
      const token2 = service.issue('session_bbbb');
      expect(token1).not.toBe(token2);
    });
  });

  describe('verify', () => {
    it('returns true for a token issued for the same sessionId', () => {
      const sid = 'session_abc123';
      const token = service.issue(sid);
      expect(service.verify(sid, token)).toBe(true);
    });

    it('returns false for a tampered token', () => {
      const sid = 'session_abc123';
      const token = service.issue(sid);
      const tampered = token.slice(0, -4) + 'XXXX';
      expect(service.verify(sid, tampered)).toBe(false);
    });

    it('returns false when the token was issued for a different sessionId', () => {
      const sid = 'session_abc123';
      const otherSid = 'session_xyz999';
      const tokenForOther = service.issue(otherSid);
      expect(service.verify(sid, tokenForOther)).toBe(false);
    });

    it('returns false for an empty token (no throw)', () => {
      expect(service.verify('session_abc123', '')).toBe(false);
    });

    it('returns false for a short token (no throw)', () => {
      expect(service.verify('session_abc123', 'short')).toBe(false);
    });
  });
});

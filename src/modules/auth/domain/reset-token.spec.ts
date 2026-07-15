import { createHash } from 'crypto';
import { generateResetToken, hashResetToken, RESET_TOKEN_TTL_MINUTES } from './reset-token';

describe('reset-token helpers', () => {
  describe('generateResetToken', () => {
    it('returns distinct raw and hash values', () => {
      const { raw, hash } = generateResetToken();
      expect(raw).not.toBe(hash);
    });

    it('raw is a 64-char hex string (32 bytes)', () => {
      const { raw } = generateResetToken();
      expect(raw).toMatch(/^[0-9a-f]{64}$/);
    });

    it('hash equals sha256(raw)', () => {
      const { raw, hash } = generateResetToken();
      const expected = createHash('sha256').update(raw).digest('hex');
      expect(hash).toBe(expected);
    });

    it('generates unique tokens each call', () => {
      const a = generateResetToken();
      const b = generateResetToken();
      expect(a.raw).not.toBe(b.raw);
      expect(a.hash).not.toBe(b.hash);
    });
  });

  describe('hashResetToken', () => {
    it('returns the same hash as generateResetToken for the same raw value', () => {
      const { raw, hash } = generateResetToken();
      expect(hashResetToken(raw)).toBe(hash);
    });

    it('is deterministic for the same input', () => {
      const raw = 'deadbeef';
      expect(hashResetToken(raw)).toBe(hashResetToken(raw));
    });
  });

  describe('RESET_TOKEN_TTL_MINUTES', () => {
    it('is 60', () => {
      expect(RESET_TOKEN_TTL_MINUTES).toBe(60);
    });
  });
});

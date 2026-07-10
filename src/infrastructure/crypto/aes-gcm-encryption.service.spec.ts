import { createCipheriv, randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { AesGcmEncryptionService } from './aes-gcm-encryption.service';

// A known 32-byte key, base64-encoded (32 bytes = 256 bits)
const TEST_KEY_BYTES = Buffer.alloc(32, 0xab);
const TEST_KEY_B64 = TEST_KEY_BYTES.toString('base64');

function makeService(): AesGcmEncryptionService {
  const configService = {
    getOrThrow: () => TEST_KEY_B64,
  } as unknown as ConfigService<Env, true>;

  return new AesGcmEncryptionService(configService);
}

describe('AesGcmEncryptionService', () => {
  let service: AesGcmEncryptionService;

  beforeEach(() => {
    service = makeService();
  });

  describe('encrypt/decrypt round-trip', () => {
    it('decrypts an encrypted ASCII string back to the original', () => {
      const plaintext = 'hello world';
      expect(service.decrypt(service.encrypt(plaintext))).toBe(plaintext);
    });

    it('decrypts an encrypted unicode string back to the original', () => {
      const plaintext = 'héllo wörld 🎉 日本語';
      expect(service.decrypt(service.encrypt(plaintext))).toBe(plaintext);
    });

    it('round-trips an empty string', () => {
      const plaintext = '';
      expect(service.decrypt(service.encrypt(plaintext))).toBe(plaintext);
    });

    it('round-trips a long string', () => {
      const plaintext = 'a'.repeat(10_000);
      expect(service.decrypt(service.encrypt(plaintext))).toBe(plaintext);
    });
  });

  describe('nonce randomness', () => {
    it('produces different ciphertext on two separate encrypt calls for the same plaintext', () => {
      const plaintext = 'same input';
      const ct1 = service.encrypt(plaintext);
      const ct2 = service.encrypt(plaintext);
      expect(ct1).not.toBe(ct2);
    });
  });

  describe('output format', () => {
    it('returns a valid base64 string', () => {
      const ct = service.encrypt('test');
      // valid base64: only chars [A-Za-z0-9+/=]
      expect(ct).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    it('decoded length is at least nonce(12) + tag(16) + plaintextBytes', () => {
      const plaintext = 'test payload';
      const plaintextBytes = Buffer.byteLength(plaintext, 'utf8');
      const decoded = Buffer.from(service.encrypt(plaintext), 'base64');
      expect(decoded.length).toBeGreaterThanOrEqual(12 + 16 + plaintextBytes);
    });

    it('decoded length for empty plaintext is exactly 12 + 16', () => {
      const decoded = Buffer.from(service.encrypt(''), 'base64');
      expect(decoded.length).toBe(12 + 16);
    });
  });

  describe('tamper detection', () => {
    it('throws when a byte in the ciphertext is flipped', () => {
      const plaintext = 'sensitive data';
      const ct = service.encrypt(plaintext);
      const buf = Buffer.from(ct, 'base64');

      // Flip a byte in the ciphertext portion (byte 12, the start of ciphertext)
      buf[12] = buf[12] ^ 0xff;
      const tampered = buf.toString('base64');

      expect(() => service.decrypt(tampered)).toThrow();
    });

    it('throws when a byte in the auth tag is flipped', () => {
      const plaintext = 'sensitive data';
      const ct = service.encrypt(plaintext);
      const buf = Buffer.from(ct, 'base64');

      // Flip the last byte (part of the tag)
      buf[buf.length - 1] = buf[buf.length - 1] ^ 0xff;
      const tampered = buf.toString('base64');

      expect(() => service.decrypt(tampered)).toThrow();
    });

    it('throws when the nonce is altered', () => {
      const plaintext = 'sensitive data';
      const ct = service.encrypt(plaintext);
      const buf = Buffer.from(ct, 'base64');

      // Flip a byte in the nonce (first 12 bytes)
      buf[0] = buf[0] ^ 0xff;
      const tampered = buf.toString('base64');

      expect(() => service.decrypt(tampered)).toThrow();
    });
  });

  describe('layout compatibility: nonce(12) || ciphertext || tag(16)', () => {
    it('can decrypt a value crafted with the correct layout manually', () => {
      const key = TEST_KEY_BYTES;
      const nonce = randomBytes(12);
      const plaintext = 'layout sanity check';
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      const ciphertextBuf = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      // Layout: nonce(12) || ciphertext || tag(16)
      const combined = Buffer.concat([nonce, ciphertextBuf, tag]);
      const b64 = combined.toString('base64');

      expect(service.decrypt(b64)).toBe(plaintext);
    });
  });
});

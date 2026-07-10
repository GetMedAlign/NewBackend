import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'crypto';
import { EncryptionPort } from '../../modules/auth/domain/ports/encryption.port';
import type { Env } from '../config/env.schema';

const NONCE_BYTES = 12;
const TAG_BYTES = 16;

@Injectable()
export class AesGcmEncryptionService implements EncryptionPort {
  private readonly key: Buffer;

  constructor(private readonly configService: ConfigService<Env, true>) {
    const b64Key = this.configService.getOrThrow<string>('ENCRYPTION_KEY');
    this.key = Buffer.from(b64Key, 'base64');
  }

  encrypt(plaintext: string): string {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    // Layout: nonce(12) || ciphertext || tag(16)
    const combined = Buffer.concat([nonce, encrypted, tag]);
    return combined.toString('base64');
  }

  decrypt(ciphertext: string): string {
    const buf = Buffer.from(ciphertext, 'base64');

    if (buf.length < NONCE_BYTES + TAG_BYTES) {
      throw new Error('Ciphertext too short to contain nonce and auth tag');
    }

    const nonce = buf.subarray(0, NONCE_BYTES);
    const tag = buf.subarray(buf.length - TAG_BYTES);
    const encrypted = buf.subarray(NONCE_BYTES, buf.length - TAG_BYTES);

    const decipher = createDecipheriv('aes-256-gcm', this.key, nonce);
    decipher.setAuthTag(tag);

    // Auth-tag failures throw here — we let them propagate
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
  }
}

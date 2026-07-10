import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import type { PasswordHasherPort } from '../../domain/ports/password-hasher.port';

@Injectable()
export class Argon2PasswordHasher implements PasswordHasherPort {
  async hash(pw: string): Promise<string> {
    return argon2.hash(pw, { type: argon2.argon2id });
  }

  async verify(pw: string, hash: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, pw);
    } catch {
      // argon2.verify throws on malformed hash — treat as failed verification
      return false;
    }
  }
}

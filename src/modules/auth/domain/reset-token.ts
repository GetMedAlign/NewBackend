import { createHash, randomBytes } from 'crypto';

export const RESET_TOKEN_TTL_MINUTES = 60;

export function generateResetToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('hex');
  const hash = createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

export function hashResetToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

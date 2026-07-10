import { Injectable } from '@nestjs/common';
import { randomInt } from 'crypto';
import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import type { TwoFactorPort } from '../../domain/ports/two-factor.port';
import type { PasswordHasherPort } from '../../domain/ports/password-hasher.port';
import type { EmailSenderPort } from './email-sender.port';

const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;

interface TwoFactorRow {
  id: string;
  code_hash: string;
  expires_at: Date;
  consumed_at: Date | null;
  attempts: number;
}

interface UserEmailRow {
  email: string;
}

@Injectable()
export class EmailTwoFactor implements TwoFactorPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasherPort,
    private readonly emailSender: EmailSenderPort,
  ) {}

  async issueCode(userId: string): Promise<void> {
    // Generate a 6-digit code
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const codeHash = await this.hasher.hash(code);
    const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);

    // Persist via asSystem — two_factor_codes has no app_authenticated policy.
    // Consume any still-live codes for this user before inserting the new one,
    // so that at most one active code exists per user at any time.
    await this.prisma.asSystem(async (client) => {
      await client.$executeRaw`
        UPDATE two_factor_codes
        SET consumed_at = NOW()
        WHERE user_id = ${userId}::uuid
          AND consumed_at IS NULL
          AND expires_at > NOW()
      `;
      await client.$executeRaw`
        INSERT INTO two_factor_codes (user_id, code_hash, expires_at, attempts)
        VALUES (${userId}::uuid, ${codeHash}, ${expiresAt}, 0)
      `;
    });

    // Fetch the user's email to send the code
    const rows = await this.prisma.asSystem(
      (client) =>
        client.$queryRaw<UserEmailRow[]>`
        SELECT email FROM users WHERE id = ${userId}::uuid
      `,
    );

    const email = rows[0]?.email;
    if (!email) {
      throw new Error(`User not found: ${userId}`);
    }

    await this.emailSender.send(
      email,
      'Your verification code',
      `Your verification code is: ${code}\n\nThis code expires in ${CODE_TTL_MINUTES} minutes.`,
    );
  }

  async verifyCode(userId: string, code: string): Promise<boolean> {
    // Load the latest unconsumed, unexpired code for this user.
    // Because issueCode now consumes all prior live codes before inserting,
    // there is at most one active code per user; ordering by expires_at DESC
    // selects it correctly (TTL is fixed at CODE_TTL_MINUTES for every code).
    const rows = await this.prisma.asSystem(
      (client) =>
        client.$queryRaw<TwoFactorRow[]>`
        SELECT id, code_hash, expires_at, consumed_at, attempts
        FROM two_factor_codes
        WHERE user_id = ${userId}::uuid
          AND consumed_at IS NULL
          AND expires_at > NOW()
        ORDER BY expires_at DESC
        LIMIT 1
      `,
    );

    const row = rows[0];
    if (!row) return false;

    // Reject if attempt cap reached
    if (row.attempts >= MAX_ATTEMPTS) return false;

    const isValid = await this.hasher.verify(code, row.code_hash);

    if (isValid) {
      // Mark as consumed
      await this.prisma.asSystem(
        (client) =>
          client.$executeRaw`
          UPDATE two_factor_codes
          SET consumed_at = NOW()
          WHERE id = ${row.id}::uuid
        `,
      );
      return true;
    }

    // Increment attempt counter on failure
    await this.prisma.asSystem(
      (client) =>
        client.$executeRaw`
        UPDATE two_factor_codes
        SET attempts = attempts + 1
        WHERE id = ${row.id}::uuid
      `,
    );
    return false;
  }
}

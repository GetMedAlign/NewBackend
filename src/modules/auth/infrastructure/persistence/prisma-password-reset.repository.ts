import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import type { PasswordResetRepositoryPort } from '../../domain/ports/password-reset-repository.port';

interface UserIdRow {
  id: string;
}

interface TokenRow {
  id: string;
  user_id: string;
}

@Injectable()
export class PrismaPasswordResetRepository implements PasswordResetRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findUserIdByEmail(email: string): Promise<string | null> {
    const rows = await this.prisma.asSystem(
      (c) =>
        c.$queryRaw<UserIdRow[]>`
        SELECT id FROM users WHERE email = ${email}::citext LIMIT 1
      `,
    );
    return rows[0]?.id ?? null;
  }

  async issue(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.prisma.asSystem(
      (c) =>
        c.$executeRaw`
        INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
        VALUES (${userId}::uuid, ${tokenHash}, ${expiresAt})
      `,
    );
  }

  async findValidByEmail(
    email: string,
    tokenHash: string,
  ): Promise<{ id: string; userId: string } | null> {
    const rows = await this.prisma.asSystem(
      (c) =>
        c.$queryRaw<TokenRow[]>`
        SELECT prt.id, prt.user_id
        FROM password_reset_tokens prt
        JOIN users u ON u.id = prt.user_id
        WHERE u.email = ${email}::citext
          AND prt.token_hash = ${tokenHash}
          AND prt.expires_at > now()
          AND prt.consumed_at IS NULL
        LIMIT 1
      `,
    );
    if (!rows[0]) return null;
    return { id: rows[0].id, userId: rows[0].user_id };
  }

  async consume(id: string): Promise<void> {
    await this.prisma.asSystem(
      (c) =>
        c.$executeRaw`
        UPDATE password_reset_tokens SET consumed_at = now() WHERE id = ${id}::uuid
      `,
    );
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.prisma.asSystem(
      (c) =>
        c.$executeRaw`
        UPDATE users SET password_hash = ${passwordHash} WHERE id = ${userId}::uuid
      `,
    );
  }
}

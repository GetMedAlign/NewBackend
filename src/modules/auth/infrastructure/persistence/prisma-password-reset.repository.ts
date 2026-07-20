import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import type { PasswordResetRepositoryPort } from '../../domain/ports/password-reset-repository.port';
import type { AdminSetPasswordPort } from '../../domain/ports/admin-set-password.port';
import type { AuditEvent } from '../../domain/ports/audit.port';

interface UserIdRow {
  id: string;
}

interface TokenRow {
  id: string;
  user_id: string;
}

@Injectable()
export class PrismaPasswordResetRepository
  implements PasswordResetRepositoryPort, AdminSetPasswordPort
{
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

  /**
   * Updates the password hash and writes the admin_set_password audit row in
   * a single transaction: asSystem() alone does not open a transaction (it
   * just hands back the base client), so the atomicity comes from the
   * explicit client.$transaction(...) below. If the audit insert fails, the
   * password update rolls back with it — see admin-set-password.port.ts.
   */
  async setPasswordWithAudit(
    userId: string,
    passwordHash: string,
    auditEvent: AuditEvent,
  ): Promise<void> {
    await this.prisma.asSystem((client) =>
      client.$transaction(async (tx) => {
        await tx.$executeRaw`
          UPDATE users SET password_hash = ${passwordHash} WHERE id = ${userId}::uuid
        `;
        await tx.$executeRaw`
          SELECT append_audit_log(
            ${auditEvent.actorUserId ?? null}::uuid,
            ${auditEvent.actorRole},
            ${auditEvent.ip ?? null},
            ${auditEvent.actionType},
            ${auditEvent.affectedRecord},
            NULL::jsonb,
            NULL::jsonb,
            ${auditEvent.notes ?? null}
          )
        `;
      }),
    );
  }
}

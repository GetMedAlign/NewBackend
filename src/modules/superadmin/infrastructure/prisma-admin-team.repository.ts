import { ConflictException, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { AdminCtx } from '../../../infrastructure/security/admin-ctx';
import { EmailAlreadyExistsError } from '../../auth/domain/errors/email-already-exists.error';
import type {
  AdminRole,
  AdminTeamRepositoryPort,
  AdminUserRow,
  CreateAdminInput,
} from '../domain/ports/admin-team-repository.port';

interface AdminRow {
  id: string;
  name: string | null;
  email: string;
  role: AdminRole;
  created_at: Date;
}

/** True for a Postgres unique-violation (code 23505). */
function isUniqueViolation(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  if (e['code'] === '23505') return true;
  const msg = typeof e['message'] === 'string' ? e['message'].toLowerCase() : '';
  return msg.includes('unique') || msg.includes('duplicate key');
}

/** True for a Postgres foreign-key-violation (code 23503). */
function isForeignKeyViolation(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  if (e['code'] === '23503') return true;
  const msg = typeof e['message'] === 'string' ? e['message'].toLowerCase() : '';
  return msg.includes('foreign key');
}

function toAdminUserRow(row: AdminRow): AdminUserRow {
  return {
    id: row.id,
    name: row.name ?? '',
    email: row.email,
    role: row.role,
    createdAt: row.created_at.toISOString(),
  };
}

@Injectable()
export class PrismaAdminTeamRepository implements AdminTeamRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async listAdmins(ctx: AdminCtx): Promise<AdminUserRow[]> {
    return this.prisma.withUserContext(
      { userId: ctx.userId, role: ctx.role, ip: ctx.ip },
      async (tx) => {
        const rows = await tx.$queryRaw<AdminRow[]>`
          SELECT
            u.id,
            u.name,
            u.email,
            u.created_at AS "created_at",
            ur.role
          FROM users u
          JOIN user_roles ur ON ur.user_id = u.id
          WHERE ur.role IN ('admin', 'superadmin')
          ORDER BY u.created_at
        `;
        return rows.map(toAdminUserRow);
      },
    );
  }

  async createAdmin(ctx: AdminCtx, input: CreateAdminInput): Promise<AdminUserRow> {
    try {
      return await this.prisma.withUserContext(
        { userId: ctx.userId, role: ctx.role, ip: ctx.ip },
        async (tx) => {
          const created = await tx.$queryRaw<
            { id: string; name: string | null; email: string; created_at: Date }[]
          >`
            INSERT INTO users (email, password_hash, name, email_confirmed, updated_at)
            VALUES (${input.email}::citext, ${input.passwordHash}, ${input.name}, true, now())
            RETURNING id, name, email, created_at AS "created_at"
          `;
          const row = created[0];
          if (!row) throw new Error('Insert into users did not return a row');

          await tx.$executeRaw`
            INSERT INTO user_roles (user_id, role)
            VALUES (${row.id}::uuid, ${input.role}::app_role)
          `;

          return toAdminUserRow({ ...row, role: input.role });
        },
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw new EmailAlreadyExistsError(input.email);
      throw err;
    }
  }

  async deleteAdmin(ctx: AdminCtx, id: string): Promise<boolean> {
    return this.prisma.withUserContext(
      { userId: ctx.userId, role: ctx.role, ip: ctx.ip },
      async (tx) => {
        try {
          const affected = await tx.$executeRaw`
            DELETE FROM users
            WHERE id = ${id}::uuid
              AND EXISTS (
                SELECT 1 FROM user_roles ur
                WHERE ur.user_id = users.id AND ur.role IN ('admin', 'superadmin')
              )
          `;
          return affected > 0;
        } catch (err) {
          if (isForeignKeyViolation(err)) {
            throw new ConflictException(
              'Cannot delete this admin: other records (e.g. clinic notes) still reference them.',
            );
          }
          throw err;
        }
      },
    );
  }

  async setAdminPassword(ctx: AdminCtx, id: string, passwordHash: string): Promise<boolean> {
    return this.prisma.withUserContext(
      { userId: ctx.userId, role: ctx.role, ip: ctx.ip },
      async (tx) => {
        const affected = await tx.$executeRaw`
          UPDATE users
          SET password_hash = ${passwordHash}
          WHERE id = ${id}::uuid
            AND EXISTS (
              SELECT 1 FROM user_roles ur
              WHERE ur.user_id = users.id AND ur.role IN ('admin', 'superadmin')
            )
        `;
        return affected > 0;
      },
    );
  }
}

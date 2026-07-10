import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import type { UserRepositoryPort } from '../../domain/ports/user-repository.port';
import { User } from '../../domain/entities/user.entity';

/**
 * Role priority order for getPrimaryRole.
 * When a user has multiple roles, we return the highest-privilege one:
 * admin > superadmin > clinic > patient.
 *
 * Rationale: admin is the operational high-trust role used day-to-day;
 * superadmin is the root account and is ordered just below admin here so
 * that a user who is both admin and superadmin is surfaced as admin.
 * clinic ranks above patient since clinic users have broader data access.
 */
const ROLE_PRIORITY: Record<string, number> = {
  admin: 4,
  superadmin: 3,
  clinic: 2,
  patient: 1,
};

const FAILED_LOGIN_LOCK_THRESHOLD = 5;
const LOCK_DURATION_MINUTES = 15;

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  email_confirmed: boolean;
  failed_login_count: number;
  locked_until: Date | null;
}

interface RoleRow {
  role: string;
}

@Injectable()
export class PrismaUserRepository implements UserRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calls the SECURITY DEFINER DB function create_user, which inserts the
   * user row and assigns the default 'patient' role in a single atomic step.
   */
  async create(email: string, passwordHash: string): Promise<string> {
    const rows = await this.prisma.asSystem((client) =>
      client.$queryRaw<{ id: string }[]>`
        SELECT create_user(${email}::citext, ${passwordHash}) AS id
      `,
    );
    const id = rows[0]?.id;
    if (!id) throw new Error('create_user did not return an id');
    return id;
  }

  async findByEmail(email: string): Promise<User | null> {
    const rows = await this.prisma.asSystem((client) =>
      client.$queryRaw<UserRow[]>`
        SELECT id, email, password_hash, email_confirmed, failed_login_count, locked_until
        FROM users
        WHERE email = ${email}::citext
        LIMIT 1
      `,
    );
    return rows[0] ? this.toEntity(rows[0]) : null;
  }

  async findById(id: string): Promise<User | null> {
    const rows = await this.prisma.asSystem((client) =>
      client.$queryRaw<UserRow[]>`
        SELECT id, email, password_hash, email_confirmed, failed_login_count, locked_until
        FROM users
        WHERE id = ${id}::uuid
        LIMIT 1
      `,
    );
    return rows[0] ? this.toEntity(rows[0]) : null;
  }

  /**
   * Returns the user's primary role, using the defined priority order.
   * If somehow no roles exist, falls back to 'patient'.
   */
  async getPrimaryRole(userId: string): Promise<string> {
    const rows = await this.prisma.asSystem((client) =>
      client.$queryRaw<RoleRow[]>`
        SELECT role FROM user_roles WHERE user_id = ${userId}::uuid
      `,
    );

    if (rows.length === 0) return 'patient';

    return rows.reduce<string>((best, row) => {
      const bestPriority = ROLE_PRIORITY[best] ?? 0;
      const rowPriority = ROLE_PRIORITY[row.role] ?? 0;
      return rowPriority > bestPriority ? row.role : best;
    }, 'patient');
  }

  /**
   * Increments failed_login_count. When the count reaches the threshold,
   * sets locked_until = now + 15 minutes.
   */
  async recordFailedLogin(id: string): Promise<void> {
    const lockAt = new Date(Date.now() + LOCK_DURATION_MINUTES * 60 * 1000);

    await this.prisma.asSystem((client) =>
      client.$executeRaw`
        UPDATE users
        SET
          failed_login_count = failed_login_count + 1,
          locked_until = CASE
            WHEN (failed_login_count + 1) >= ${FAILED_LOGIN_LOCK_THRESHOLD}
            THEN ${lockAt}
            ELSE locked_until
          END
        WHERE id = ${id}::uuid
      `,
    );
  }

  /** Clears failed_login_count and removes the account lock. */
  async resetFailedLogin(id: string): Promise<void> {
    await this.prisma.asSystem((client) =>
      client.$executeRaw`
        UPDATE users
        SET failed_login_count = 0, locked_until = NULL
        WHERE id = ${id}::uuid
      `,
    );
  }

  private toEntity(row: UserRow): User {
    return new User({
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      emailConfirmed: row.email_confirmed,
      failedLoginCount: row.failed_login_count,
      lockedUntil: row.locked_until,
    });
  }
}

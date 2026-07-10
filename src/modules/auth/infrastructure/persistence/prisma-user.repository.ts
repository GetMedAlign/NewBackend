import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import type { UserRepositoryPort } from '../../domain/ports/user-repository.port';
import type { EncryptionPort } from '../../domain/ports/encryption.port';
import { ENCRYPTION_PORT } from '../../domain/ports/encryption.port';
import { User } from '../../domain/entities/user.entity';
import { EmailAlreadyExistsError } from '../../domain/errors/email-already-exists.error';

/**
 * Role priority order for getPrimaryRole.
 * When a user has multiple roles, we return the highest-privilege one:
 * superadmin > admin > clinic > patient.
 */
const ROLE_PRIORITY: Record<string, number> = {
  superadmin: 4,
  admin: 3,
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

interface RecoveryPhoneRow {
  recovery_phone_encrypted: string | null;
}

/** Returns true when a Postgres error looks like a unique-violation (code 23505). */
function isUniqueViolation(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  if (e['code'] === '23505') return true;
  const msg = typeof e['message'] === 'string' ? e['message'].toLowerCase() : '';
  return msg.includes('unique') || msg.includes('duplicate key');
}

@Injectable()
export class PrismaUserRepository implements UserRepositoryPort {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENCRYPTION_PORT) private readonly encryption: EncryptionPort,
  ) {}

  /**
   * Calls the SECURITY DEFINER DB function create_user, which inserts the
   * user row and assigns the default 'patient' role in a single atomic step.
   */
  async create(email: string, passwordHash: string): Promise<string> {
    try {
      const rows = await this.prisma.asSystem((client) =>
        client.$queryRaw<{ id: string }[]>`
          SELECT create_user(${email}::citext, ${passwordHash}) AS id
        `,
      );
      const id = rows[0]?.id;
      if (!id) throw new Error('create_user did not return an id');
      return id;
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        throw new EmailAlreadyExistsError(email);
      }
      throw err;
    }
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
      // NOTE: Auth-identity reads use asSystem by design — the auth layer owns
      // user records and bypasses RLS intentionally. In later feature slices,
      // genuinely user-scoped reads MUST use withUserContext (RLS-enforced).
      // Do not copy this pattern for business-domain data access.
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

  /**
   * Encrypts phone via EncryptionPort and persists the ciphertext to
   * users.recovery_phone_encrypted (§8/§12.3: field-level encryption at rest).
   */
  async setRecoveryPhone(userId: string, phone: string): Promise<void> {
    const ciphertext = this.encryption.encrypt(phone);
    await this.prisma.asSystem((client) =>
      client.$executeRaw`
        UPDATE users
        SET recovery_phone_encrypted = ${ciphertext}
        WHERE id = ${userId}::uuid
      `,
    );
  }

  /**
   * Reads recovery_phone_encrypted from users via asSystem; if null returns
   * null; otherwise decrypts via EncryptionPort and returns plaintext.
   */
  async getRecoveryPhone(userId: string): Promise<string | null> {
    const rows = await this.prisma.asSystem((client) =>
      client.$queryRaw<RecoveryPhoneRow[]>`
        SELECT recovery_phone_encrypted
        FROM users
        WHERE id = ${userId}::uuid
        LIMIT 1
      `,
    );
    const raw = rows[0]?.recovery_phone_encrypted ?? null;
    if (raw === null) return null;
    return this.encryption.decrypt(raw);
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

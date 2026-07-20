/**
 * E2E tests for POST /admin/clinics/:id/send-password-reset and
 * POST /admin/clinics/:id/set-password.
 *
 * Strategy: boot the full AppModule, craft an admin token via JwtTokenService
 * (mirrors admin-clinics-read.e2e-spec.ts / admin-clinic-notes.e2e-spec.ts),
 * and create clinic-linked users via the real POST /auth/signup flow so they
 * have a genuine argon2 password hash — then link them to a clinic by
 * setting users.clinic_id directly (mirrors the clinic_portal migration).
 *
 * A CapturingEmailSender (mirrors test/auth/password-reset.e2e-spec.ts)
 * records every sent email body so the test can pull the raw reset token and
 * the 2FA code out of them without needing a real mailbox.
 *
 * Covers:
 *   - send-password-reset: 200 {success:true}; inserts exactly one
 *     password_reset_tokens row for the linked user whose token_hash is NOT
 *     the raw token from the emailed link (proves only the hash is stored).
 *   - set-password: 200 {success:true}; writes an admin_set_password audit
 *     row naming the acting admin; the clinic user can then complete a real
 *     sign-in (signin -> capture 2FA code -> verify -> session cookie) with
 *     the new password, and the old password no longer works.
 *   - set-password with a newPassword under 8 chars -> 400.
 *   - both routes -> 404 "No user account found for this clinic." when the
 *     clinic has no linked user.
 *   - both routes -> 403 for a non-admin.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import cookieParser = require('cookie-parser');
// eslint-disable-next-line @typescript-eslint/no-require-imports
import supertest = require('supertest');

import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/infrastructure/security/all-exceptions.filter';
import { EMAIL_SENDER } from '../../src/modules/auth/infrastructure/adapters/email-sender.port';
import type { EmailSenderPort } from '../../src/modules/auth/infrastructure/adapters/email-sender.port';
import { WEBHOOK_SENDER } from '../../src/modules/leads/domain/ports/webhook-sender.port';
import type {
  WebhookSenderPort,
  WebhookSendResult,
} from '../../src/modules/leads/domain/ports/webhook-sender.port';
import { STORAGE_PORT } from '../../src/modules/clinic-media/domain/ports/storage.port';
import type { StoragePort } from '../../src/modules/clinic-media/domain/ports/storage.port';
import { TOKEN_SERVICE } from '../../src/modules/auth/domain/ports/token-service.port';
import type { TokenServicePort } from '../../src/modules/auth/domain/ports/token-service.port';

class CapturingEmailSender implements EmailSenderPort {
  public readonly lastBodyByEmail = new Map<string, string>();

  async send(to: string, _subject: string, body: string): Promise<void> {
    this.lastBodyByEmail.set(to.toLowerCase(), body);
  }

  bodyFor(email: string): string {
    const body = this.lastBodyByEmail.get(email.toLowerCase());
    if (!body) throw new Error(`No email captured for ${email}`);
    return body;
  }

  tokenFor(email: string): string {
    const body = this.bodyFor(email);
    const match = /[?&]token=([0-9a-f]+)/.exec(body);
    if (!match) throw new Error(`No token in email body: ${body}`);
    return match[1]!;
  }

  twoFactorCodeFor(email: string): string {
    const body = this.bodyFor(email);
    const match = /verification code is: (\d{6})/.exec(body);
    if (!match) throw new Error(`No 2FA code in email body: ${body}`);
    return match[1]!;
  }
}

class StubWebhookSender implements WebhookSenderPort {
  async send(): Promise<WebhookSendResult> {
    return { ok: true, status: 200 };
  }
}

const mockStorage: StoragePort = {
  createSignedUploadUrl: async (path: string) => ({
    uploadUrl: `https://storage.test/${path}`,
    token: 'test-token',
  }),
  publicUrl: (path: string) => `https://storage.test/${path}`,
  remove: async () => {},
  pathFromPublicUrl: () => null,
};

function cookieValue(setCookie: string[] | undefined, name: string): string | undefined {
  if (!setCookie) return undefined;
  for (const raw of setCookie) {
    const [pair] = raw.split(';');
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() === name) return pair.slice(eq + 1).trim();
  }
  return undefined;
}

interface TokenRow {
  id: string;
  user_id: string;
  token_hash: string;
}

interface AuditRow {
  actor_user_id: string | null;
  actor_role: string;
  action_type: string;
  affected_record: string;
}

describe('Admin clinic password routes (e2e)', () => {
  let app: INestApplication;
  let tokenService: TokenServicePort;
  let adminToken: string;
  let patientToken: string;
  let csrfToken: string;
  const emailSender = new CapturingEmailSender();

  const createdClinicIds: string[] = [];
  const createdUserIds: string[] = [];

  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const seedPrisma = new PrismaClient({ adapter });

  let adminUserId: string;
  let patientUserId: string;

  const unique = Date.now();

  const baseClinicData = {
    rating: 0,
    reviewCount: 0,
    telehealthAvailable: false,
    financingAvailable: false,
    acceptsInsurance: false,
    status: 'active',
    billingStatus: 'no_card',
    notifyOnLead: false,
  };

  async function createClinic(slugSuffix: string): Promise<string> {
    const clinic = await seedPrisma.clinic.create({
      data: {
        slug: `e2e-admin-clinic-pwd-${slugSuffix}-${unique.toString()}`,
        name: `E2E Password Clinic ${slugSuffix} ${unique.toString()}`,
        ...baseClinicData,
      },
      select: { id: true },
    });
    createdClinicIds.push(clinic.id);
    return clinic.id;
  }

  /** Creates a real user (genuine argon2 hash) via /auth/signup, then links it to the clinic. */
  async function createClinicUser(
    clinicId: string,
    emailLocal: string,
    password: string,
  ): Promise<{ userId: string; email: string }> {
    const email = `${emailLocal}-${unique.toString()}@test.example.com`;
    const res = await agent()
      .post('/auth/signup')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ email, password })
      .expect(201);
    const userId = (res.body as { userId: string }).userId;
    createdUserIds.push(userId);
    await seedPrisma.$executeRaw`
      UPDATE users SET clinic_id = ${clinicId}::uuid WHERE id = ${userId}::uuid
    `;
    return { userId, email };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_SENDER)
      .useValue(emailSender)
      .overrideProvider(WEBHOOK_SENDER)
      .useValue(new StubWebhookSender())
      .overrideProvider(STORAGE_PORT)
      .useValue(mockStorage)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    tokenService = moduleRef.get<TokenServicePort>(TOKEN_SERVICE);

    const adminRows = await seedPrisma.$queryRaw<{ id: string }[]>`
      SELECT u.id FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      WHERE u.email = 'superadmin@medalign-seed.example.com'::citext
        AND ur.role = 'superadmin'
      LIMIT 1
    `;
    if (adminRows.length === 0) {
      throw new Error('Seeded superadmin not found — run pnpm seed:pj against the test DB first.');
    }
    adminUserId = adminRows[0]!.id;

    const patientEmail = `admin-clinic-pwd-e2e-patient-${unique.toString()}@test.example.com`;
    const patientRows = await seedPrisma.$queryRaw<{ id: string }[]>`
      SELECT create_user(${patientEmail}::citext, 'test-hash') AS id
    `;
    patientUserId = patientRows[0]!.id;
    createdUserIds.push(patientUserId);

    adminToken = tokenService.issue({ sub: adminUserId, role: 'superadmin' });
    patientToken = tokenService.issue({ sub: patientUserId, role: 'patient' });

    const csrfRes = await supertest(app.getHttpServer()).get('/health');
    csrfToken = cookieValue(csrfRes.headers['set-cookie'] as unknown as string[], 'csrf_token')!;
    expect(csrfToken).toBeTruthy();
  });

  afterAll(async () => {
    for (const id of createdClinicIds) {
      await seedPrisma.$executeRaw`DELETE FROM leads WHERE clinic_id = ${id}::uuid`;
      await seedPrisma.$executeRaw`UPDATE users SET clinic_id = NULL WHERE clinic_id = ${id}::uuid`;
      await seedPrisma.$executeRaw`DELETE FROM clinics WHERE id = ${id}::uuid`;
    }
    for (const id of createdUserIds) {
      await seedPrisma.$executeRaw`DELETE FROM patients WHERE user_id = ${id}::uuid`;
      await seedPrisma.$executeRaw`DELETE FROM users WHERE id = ${id}::uuid`;
    }
    await app.close();
    await seedPrisma.$disconnect();
    await pool.end();
  });

  const agent = () => supertest(app.getHttpServer());
  const adminHeaders = () => ({
    Cookie: `access_token=${adminToken}; csrf_token=${csrfToken}`,
    'x-csrf-token': csrfToken,
  });
  const patientHeaders = () => ({
    Cookie: `access_token=${patientToken}; csrf_token=${csrfToken}`,
    'x-csrf-token': csrfToken,
  });
  describe('POST /admin/clinics/:id/send-password-reset', () => {
    it('returns {success:true}, inserts exactly one password_reset_tokens row, and never stores the raw token', async () => {
      const clinicId = await createClinic('reset');
      const { userId, email } = await createClinicUser(clinicId, 'reset-user', 'OriginalPass1!');

      const res = await agent()
        .post(`/admin/clinics/${clinicId}/send-password-reset`)
        .set(adminHeaders())
        .expect(200);
      expect(res.body).toEqual({ success: true });

      const rawToken = emailSender.tokenFor(email);
      expect(rawToken).toMatch(/^[0-9a-f]{64}$/);

      const link = emailSender.bodyFor(email);
      expect(link).toContain(`/reset-password?email=${encodeURIComponent(email)}&token=`);

      const rows = await seedPrisma.$queryRaw<TokenRow[]>`
        SELECT id, user_id, token_hash FROM password_reset_tokens WHERE user_id = ${userId}::uuid
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.token_hash).not.toBe(rawToken);
      expect(rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('returns 404 "No user account found for this clinic." when the clinic has no linked user', async () => {
      const clinicId = await createClinic('reset-no-user');
      const res = await agent()
        .post(`/admin/clinics/${clinicId}/send-password-reset`)
        .set(adminHeaders())
        .expect(404);
      expect((res.body as { error: { message: string } }).error.message).toBe(
        'No user account found for this clinic.',
      );
    });

    it('returns 403 for a non-admin', async () => {
      const clinicId = await createClinic('reset-forbidden');
      await agent()
        .post(`/admin/clinics/${clinicId}/send-password-reset`)
        .set(patientHeaders())
        .expect(403);
    });
  });

  describe('POST /admin/clinics/:id/set-password', () => {
    it('sets the password, writes an admin_set_password audit row, and lets the user sign in with it', async () => {
      const clinicId = await createClinic('set');
      const oldPassword = 'OriginalPass1!';
      const newPassword = 'BrandNewPass2!';
      const { userId, email } = await createClinicUser(clinicId, 'set-user', oldPassword);

      const res = await agent()
        .post(`/admin/clinics/${clinicId}/set-password`)
        .set(adminHeaders())
        .send({ newPassword })
        .expect(200);
      expect(res.body).toEqual({ success: true });

      // Audit entry naming the acting admin.
      const auditRows = await seedPrisma.$queryRaw<AuditRow[]>`
        SELECT actor_user_id, actor_role, action_type, affected_record
        FROM audit_log
        WHERE action_type = 'admin_set_password' AND affected_record = ${userId}
        ORDER BY created_at DESC
        LIMIT 1
      `;
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0]!.actor_user_id).toBe(adminUserId);
      expect(auditRows[0]!.actor_role).toBe('superadmin');
      expect(auditRows[0]!.affected_record).toBe(userId);

      // Real sign-in flow with the new password: signin -> 2FA code -> verify -> session cookie.
      const signinRes = await agent()
        .post('/auth/signin')
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ email, password: newPassword })
        .expect(200);
      expect(signinRes.body).toEqual({ requiresTwoFactor: true });

      const code = emailSender.twoFactorCodeFor(email);
      const verifyRes = await agent()
        .post('/auth/2fa/verify')
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ email, code })
        .expect(200);
      expect((verifyRes.body as { userId: string }).userId).toBe(userId);
      const sessionCookie = cookieValue(
        verifyRes.headers['set-cookie'] as unknown as string[],
        'access_token',
      );
      expect(sessionCookie).toBeTruthy();

      // Old password no longer works.
      await agent()
        .post('/auth/signin')
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ email, password: oldPassword })
        .expect(401);
    });

    it('returns 400 when newPassword is shorter than 8 characters', async () => {
      const clinicId = await createClinic('set-short');
      await createClinicUser(clinicId, 'set-short-user', 'OriginalPass1!');

      await agent()
        .post(`/admin/clinics/${clinicId}/set-password`)
        .set(adminHeaders())
        .send({ newPassword: 'short1' })
        .expect(400);
    });

    it('returns 404 "No user account found for this clinic." when the clinic has no linked user', async () => {
      const clinicId = await createClinic('set-no-user');
      const res = await agent()
        .post(`/admin/clinics/${clinicId}/set-password`)
        .set(adminHeaders())
        .send({ newPassword: 'SomePassword1!' })
        .expect(404);
      expect((res.body as { error: { message: string } }).error.message).toBe(
        'No user account found for this clinic.',
      );
    });

    it('returns 403 for a non-admin', async () => {
      const clinicId = await createClinic('set-forbidden');
      await agent()
        .post(`/admin/clinics/${clinicId}/set-password`)
        .set(patientHeaders())
        .send({ newPassword: 'SomePassword1!' })
        .expect(403);
    });
  });
});

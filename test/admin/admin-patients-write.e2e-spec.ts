/**
 * E2E tests for PUT /admin/patients/:id and DELETE /admin/patients/:id.
 *
 * Strategy: boot the full AppModule, craft tokens via JwtTokenService, and
 * exercise the write routes against real patient rows created directly in
 * the DB (mirrors test/admin/admin-patients-read.e2e-spec.ts). A
 * CapturingEmailSender (mirrors test/admin/admin-clinic-password.e2e-spec.ts)
 * records sent emails so the regression test can pull the raw reset token.
 *
 * Covers:
 *   - PUT: a partial update to `name` changes users.name and leaves
 *     patients.zip_code / patients.date_of_birth untouched (read back from
 *     the DB directly, not just via the API response).
 *   - PUT: an unparseable dob returns 200 and leaves date_of_birth unchanged.
 *   - PUT: 409 on an already-deleted patient.
 *   - DELETE: {success:true}, sets is_deleted/deleted_at, and locks the
 *     patient's user via the DELETED_LOCK_UNTIL sentinel — read back from
 *     the DB to prove both writes landed.
 *   - DELETE: a second delete returns 409.
 *   - Both routes 404 on an unknown id and 403 for a non-admin.
 *   - Regression (spec §3.3): a soft-deleted patient who completes a REAL
 *     forgot-password + reset-password cycle is still refused sign-in,
 *     because the deletion lock is untouched by reset-password.use-case.ts.
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

const DELETED_LOCK_UNTIL = new Date('9999-12-31T23:59:59.000Z');

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

interface PatientRow {
  user_id: string;
  name: string | null;
  zip_code: string | null;
  date_of_birth: Date | null;
  is_deleted: boolean;
  deleted_at: Date | null;
}

describe('Admin patients write routes (e2e)', () => {
  let app: INestApplication;
  let tokenService: TokenServicePort;
  let adminToken: string;
  let patientToken: string;
  let csrfToken: string;
  const emailSender = new CapturingEmailSender();

  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const seedPrisma = new PrismaClient({ adapter });

  let adminUserId: string;
  let nonAdminPatientUserId: string;

  const unique = Date.now();
  let counter = 0;

  const createdUserIds: string[] = [];
  const createdPatientIds: string[] = [];

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

    const nonAdminEmail = `admin-patients-write-e2e-nonadmin-${unique.toString()}@test.example.com`;
    const nonAdminRows = await seedPrisma.$queryRaw<{ id: string }[]>`
      SELECT create_user(${nonAdminEmail}::citext, 'test-hash') AS id
    `;
    nonAdminPatientUserId = nonAdminRows[0]!.id;
    createdUserIds.push(nonAdminPatientUserId);

    adminToken = tokenService.issue({ sub: adminUserId, role: 'superadmin' });
    patientToken = tokenService.issue({ sub: nonAdminPatientUserId, role: 'patient' });

    const csrfRes = await supertest(app.getHttpServer()).get('/health');
    csrfToken = cookieValue(csrfRes.headers['set-cookie'] as unknown as string[], 'csrf_token')!;
    expect(csrfToken).toBeTruthy();
  });

  afterAll(async () => {
    if (createdPatientIds.length > 0) {
      await seedPrisma.$executeRaw`DELETE FROM patients WHERE id = ANY(${createdPatientIds}::uuid[])`;
    }
    if (createdUserIds.length > 0) {
      await seedPrisma.$executeRaw`DELETE FROM patients WHERE user_id = ANY(${createdUserIds}::uuid[])`;
      await seedPrisma.$executeRaw`DELETE FROM users WHERE id = ANY(${createdUserIds}::uuid[])`;
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

  /** Creates a patient (with a bare, non-signed-up user) directly in the DB. */
  async function createPatient(opts: {
    name?: string;
    zipCode?: string;
    dob?: string;
    deleted?: boolean;
  }): Promise<{ patientId: string; userId: string; email: string }> {
    counter += 1;
    const email = `admin-patients-write-e2e-${unique.toString()}-${counter.toString()}@test.example.com`;
    const userRows = await seedPrisma.$queryRaw<{ id: string }[]>`
      SELECT create_user(${email}::citext, 'test-hash') AS id
    `;
    const userId = userRows[0]!.id;
    createdUserIds.push(userId);

    if (opts.name !== undefined) {
      await seedPrisma.$executeRaw`UPDATE users SET name = ${opts.name} WHERE id = ${userId}::uuid`;
    }

    const patientRows = await seedPrisma.$queryRaw<{ id: string }[]>`
      INSERT INTO patients (user_id, date_of_birth, zip_code, is_deleted)
      VALUES (
        ${userId}::uuid,
        ${opts.dob ?? null}::date,
        ${opts.zipCode ?? null},
        ${opts.deleted ?? false}
      )
      RETURNING id::text AS id
    `;
    const patientId = patientRows[0]!.id;
    createdPatientIds.push(patientId);

    return { patientId, userId, email };
  }

  async function readPatientRow(patientId: string): Promise<PatientRow> {
    const rows = await seedPrisma.$queryRaw<PatientRow[]>`
      SELECT u.id AS user_id, u.name, p.zip_code, p.date_of_birth, p.is_deleted, p.deleted_at
        FROM patients p
        JOIN users u ON u.id = p.user_id
       WHERE p.id = ${patientId}::uuid
    `;
    return rows[0]!;
  }

  async function readLockedUntil(userId: string): Promise<Date | null> {
    const rows = await seedPrisma.$queryRaw<{ locked_until: Date | null }[]>`
      SELECT locked_until FROM users WHERE id = ${userId}::uuid
    `;
    return rows[0]!.locked_until;
  }

  describe('PUT /admin/patients/:id', () => {
    it('updates only the given fields, leaving the others untouched', async () => {
      const { patientId } = await createPatient({
        name: 'Original Name',
        zipCode: '11111',
        dob: '1980-01-01',
      });

      const res = await agent()
        .put(`/admin/patients/${patientId}`)
        .set(adminHeaders())
        .send({ name: 'New Name' })
        .expect(200);
      expect(res.body).toEqual({ success: true });

      const row = await readPatientRow(patientId);
      expect(row.name).toBe('New Name');
      expect(row.zip_code).toBe('11111');
      expect(row.date_of_birth?.toISOString().slice(0, 10)).toBe('1980-01-01');
    });

    it('returns 200 and leaves date_of_birth unchanged when dob is unparseable', async () => {
      const { patientId } = await createPatient({ dob: '1980-01-01' });

      const res = await agent()
        .put(`/admin/patients/${patientId}`)
        .set(adminHeaders())
        .send({ dob: 'not-a-date' })
        .expect(200);
      expect(res.body).toEqual({ success: true });

      const row = await readPatientRow(patientId);
      expect(row.date_of_birth?.toISOString().slice(0, 10)).toBe('1980-01-01');
    });

    it('updates dob when it is a valid date', async () => {
      const { patientId } = await createPatient({ dob: '1980-01-01' });

      await agent()
        .put(`/admin/patients/${patientId}`)
        .set(adminHeaders())
        .send({ dob: '1990-06-15' })
        .expect(200);

      const row = await readPatientRow(patientId);
      expect(row.date_of_birth?.toISOString().slice(0, 10)).toBe('1990-06-15');
    });

    it('returns 409 when the patient is already soft-deleted', async () => {
      const { patientId } = await createPatient({ deleted: true });

      await agent()
        .put(`/admin/patients/${patientId}`)
        .set(adminHeaders())
        .send({ name: 'Whoever' })
        .expect(409);
    });

    it('returns 404 "Patient not found." for an unknown but well-formed uuid', async () => {
      const res = await agent()
        .put('/admin/patients/00000000-0000-0000-0000-000000000000')
        .set(adminHeaders())
        .send({ name: 'Whoever' })
        .expect(404);
      expect((res.body as { error: { message: string } }).error.message).toBe('Patient not found.');
    });

    it('returns 403 for a non-admin', async () => {
      const { patientId } = await createPatient({});
      await agent()
        .put(`/admin/patients/${patientId}`)
        .set(patientHeaders())
        .send({ name: 'Whoever' })
        .expect(403);
    });
  });

  describe('DELETE /admin/patients/:id', () => {
    it('soft-deletes the patient and locks the linked user out via the deletion sentinel', async () => {
      const { patientId, userId } = await createPatient({});

      const res = await agent()
        .delete(`/admin/patients/${patientId}`)
        .set(adminHeaders())
        .expect(200);
      expect(res.body).toEqual({ success: true });

      const row = await readPatientRow(patientId);
      expect(row.is_deleted).toBe(true);
      expect(row.deleted_at).not.toBeNull();

      const lockedUntil = await readLockedUntil(userId);
      expect(lockedUntil?.toISOString()).toBe(DELETED_LOCK_UNTIL.toISOString());
    });

    it('returns 409 on a second delete of the same patient', async () => {
      const { patientId } = await createPatient({});

      await agent().delete(`/admin/patients/${patientId}`).set(adminHeaders()).expect(200);
      await agent().delete(`/admin/patients/${patientId}`).set(adminHeaders()).expect(409);
    });

    it('returns 404 "Patient not found." for an unknown but well-formed uuid', async () => {
      const res = await agent()
        .delete('/admin/patients/00000000-0000-0000-0000-000000000000')
        .set(adminHeaders())
        .expect(404);
      expect((res.body as { error: { message: string } }).error.message).toBe('Patient not found.');
    });

    it('returns 403 for a non-admin', async () => {
      const { patientId } = await createPatient({});
      await agent().delete(`/admin/patients/${patientId}`).set(patientHeaders()).expect(403);
    });
  });

  describe('deletion lock survives password reset (spec §3.3 regression)', () => {
    it('keeps a soft-deleted patient locked out even after a valid password reset', async () => {
      // A real, signed-up user with a genuine argon2 password hash, linked to
      // a patients row — so the forgot/reset-password flow below operates on
      // a real account, not a DB fixture.
      const patientEmail = `admin-patients-write-e2e-lockreg-${unique.toString()}@test.example.com`;
      const originalPassword = 'OriginalPassw0rd!';

      const signupRes = await agent()
        .post('/auth/signup')
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ email: patientEmail, password: originalPassword })
        .expect(201);
      const signedUpUserId = (signupRes.body as { userId: string }).userId;
      createdUserIds.push(signedUpUserId);

      // Signup already creates the 1:1 patients row atomically (see
      // prisma-user.repository.ts), so look it up rather than inserting one.
      const patientRows = await seedPrisma.$queryRaw<{ id: string }[]>`
        SELECT id::text AS id FROM patients WHERE user_id = ${signedUpUserId}::uuid
      `;
      const patientId = patientRows[0]!.id;
      createdPatientIds.push(patientId);

      // 1. Admin soft-deletes the patient.
      await agent().delete(`/admin/patients/${patientId}`).set(adminHeaders()).expect(200);

      // 2. The patient completes a full, valid forgot-password + reset-password
      //    cycle through the real endpoints, reading the raw token from the
      //    captured email.
      await agent()
        .post('/auth/forgot-password')
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ email: patientEmail })
        .expect(200);

      const rawToken = emailSender.tokenFor(patientEmail);
      const newPassword = 'BrandNewPassw0rd!';

      await agent()
        .post('/auth/reset-password')
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ email: patientEmail, token: rawToken, newPassword })
        .expect(200);

      // 3. Sign-in with the NEW password must still be refused: the deletion
      //    lock survives a valid password reset.
      const res = await agent()
        .post('/auth/signin')
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ email: patientEmail, password: newPassword });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).not.toBe(200);
    });
  });
});

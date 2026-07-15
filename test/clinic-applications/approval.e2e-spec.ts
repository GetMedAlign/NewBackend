/**
 * E2E tests for PUT /admin/applications/:id/status (approve / deny).
 *
 * Full onboarding journey:
 *   POST /clinic-applications (anonymous submit)
 *   → admin PUT /admin/applications/:id/status { status: 'approved' } → 200 { clinicId }
 *   → the provisioned clinic user completes POST /auth/reset-password with the
 *     emailed token → signs in (signin + 2FA) → GET /clinic/portal/profile.
 *
 * Also covers:
 *   - patient token on the admin endpoint → 403
 *   - a second approve on the same application → 409
 *   - { status: 'bogus' } → 400
 *
 * The email seam (EMAIL_SENDER) is stubbed with a capturing sender so the test
 * can recover the set-password token and the 6-digit 2FA code.
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
    const match = this.bodyFor(email).match(/[?&]token=([0-9a-f]+)/);
    if (!match) throw new Error(`No token in email body for ${email}`);
    return match[1]!;
  }

  codeFor(email: string): string {
    const match = this.bodyFor(email).match(/\b(\d{6})\b/);
    if (!match) throw new Error(`No 6-digit code in email body for ${email}`);
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

describe('PUT /admin/applications/:id/status (e2e)', () => {
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
  let patientUserId: string;

  const unique = Date.now();
  const applicantEmail = `e2e-approve-${unique}@test.example.com`;
  const createdApplicationIds: string[] = [];
  const createdClinicIds: string[] = [];

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
      WHERE u.email = 'superadmin@medalign-seed.example.com'::citext AND ur.role = 'superadmin'
      LIMIT 1
    `;
    if (adminRows.length === 0) {
      throw new Error('Seeded superadmin not found — run pnpm seed:pj against the test DB first.');
    }
    adminUserId = adminRows[0]!.id;

    const patientEmail = `e2e-approve-patient-${unique}@test.example.com`;
    const patientRows = await seedPrisma.$queryRaw<{ id: string }[]>`
      SELECT create_user(${patientEmail}::citext, 'test-hash') AS id
    `;
    patientUserId = patientRows[0]!.id;

    adminToken = tokenService.issue({ sub: adminUserId, role: 'superadmin' });
    patientToken = tokenService.issue({ sub: patientUserId, role: 'patient' });

    const csrfRes = await supertest(app.getHttpServer()).get('/health');
    csrfToken = cookieValue(csrfRes.headers['set-cookie'] as unknown as string[], 'csrf_token')!;
  });

  afterAll(async () => {
    // Delete the provisioned clinic user (references the clinic).
    await seedPrisma.$executeRaw`DELETE FROM users WHERE email = ${applicantEmail}::citext`;
    await seedPrisma.$executeRaw`DELETE FROM users WHERE id = ${patientUserId}::uuid`;
    for (const id of createdApplicationIds) {
      await seedPrisma.$executeRaw`
        UPDATE clinic_applications SET created_clinic_id = NULL WHERE id = ${id}::uuid
      `;
      await seedPrisma.$executeRaw`DELETE FROM clinic_applications WHERE id = ${id}::uuid`;
    }
    for (const id of createdClinicIds) {
      await seedPrisma.$executeRaw`DELETE FROM clinics WHERE id = ${id}::uuid`;
    }
    await app.close();
    await seedPrisma.$disconnect();
    await pool.end();
  });

  const agent = () => supertest(app.getHttpServer());

  async function submitApplication(): Promise<string> {
    const res = await agent()
      .post('/clinic-applications')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({
        clinicName: 'E2E Onboard Clinic',
        contactEmail: applicantEmail,
        city: 'Austin',
        stateCode: 'TX',
        categories: ['hormone'],
        services: [{ serviceCode: 'testosterone-replacement', isTopService: true }],
      })
      .expect(201);
    const body = res.body as { applicationId: string };
    createdApplicationIds.push(body.applicationId);
    return body.applicationId;
  }

  it('full journey: submit → approve → reset-password → signin+2FA → GET profile', async () => {
    const applicationId = await submitApplication();

    // Approve as admin.
    const approveRes = await agent()
      .put(`/admin/applications/${applicationId}/status`)
      .set('Cookie', `access_token=${adminToken}; csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ status: 'approved' })
      .expect(200);

    const approveBody = approveRes.body as { success: boolean; clinicId: string };
    expect(approveBody.success).toBe(true);
    expect(typeof approveBody.clinicId).toBe('string');
    createdClinicIds.push(approveBody.clinicId);

    // The new clinic user resets their password using the emailed token.
    const rawToken = emailSender.tokenFor(applicantEmail);
    expect(rawToken).toMatch(/^[0-9a-f]{64}$/);

    const newPassword = 'NewClinicPass1!';
    await agent()
      .post('/auth/reset-password')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ email: applicantEmail, token: rawToken, newPassword })
      .expect(200);

    // Sign in (→ 2FA challenge).
    const signinRes = await agent()
      .post('/auth/signin')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ email: applicantEmail, password: newPassword })
      .expect(200);
    expect(signinRes.body).toEqual({ requiresTwoFactor: true });

    // Verify 2FA with the emailed 6-digit code → access_token cookie.
    const code = emailSender.codeFor(applicantEmail);
    const verifyRes = await agent()
      .post('/auth/2fa/verify')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ email: applicantEmail, code })
      .expect(200);
    const clinicCookie = cookieValue(
      verifyRes.headers['set-cookie'] as unknown as string[],
      'access_token',
    )!;
    expect(clinicCookie).toBeTruthy();

    // The onboarded clinic can access its portal profile.
    const profileRes = await agent()
      .get('/clinic/portal/profile')
      .set('Cookie', `access_token=${clinicCookie}; csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .expect(200);
    const profile = profileRes.body as { name: string };
    expect(profile.name).toBe('E2E Onboard Clinic');
  });

  it('a second approve on the same application returns 409', async () => {
    // The application from the first test is now approved.
    const applicationId = createdApplicationIds[0]!;
    await agent()
      .put(`/admin/applications/${applicationId}/status`)
      .set('Cookie', `access_token=${adminToken}; csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ status: 'approved' })
      .expect(409);
  });

  it('a patient token on the admin endpoint returns 403', async () => {
    await agent()
      .put(`/admin/applications/${createdApplicationIds[0]}/status`)
      .set('Cookie', `access_token=${patientToken}; csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ status: 'approved' })
      .expect(403);
  });

  it('an invalid status returns 400', async () => {
    await agent()
      .put(`/admin/applications/${createdApplicationIds[0]}/status`)
      .set('Cookie', `access_token=${adminToken}; csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ status: 'bogus' })
      .expect(400);
  });

  it('an unknown application id returns 404', async () => {
    await agent()
      .put('/admin/applications/00000000-0000-0000-0000-000000000000/status')
      .set('Cookie', `access_token=${adminToken}; csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ status: 'denied', denyReason: 'nope' })
      .expect(404);
  });
});

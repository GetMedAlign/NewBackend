/**
 * E2E tests for GET /admin/patients and GET /admin/patients/:id.
 *
 * Strategy: boot the full AppModule, craft tokens via JwtTokenService, and
 * exercise the admin patient read endpoints. Mirrors
 * test/admin/admin-clinics-read.e2e-spec.ts.
 *
 * Covers:
 *   - Admin token → GET /admin/patients returns 200 with an array, newest-first
 *   - A soft-deleted patient appears in the list with isDeleted: true (not filtered out)
 *   - Admin token → GET /admin/patients/:id returns 200 with the matching patient,
 *     whose response keys are EXACTLY the eleven AdminPatientDto fields (no ciphertext)
 *   - Admin token → unknown but well-formed uuid → 404 "Patient not found."
 *   - Admin token → malformed uuid → 400
 *   - Patient token → 403 on both endpoints (RolesGuard)
 *   - A phi_access audit_log row is written for each admin patient route call
 *
 * Authentication: tokens are crafted directly via JwtTokenService (same
 * approach as admin-clinics-read.e2e-spec.ts).
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

class StubEmailSender implements EmailSenderPort {
  async send(): Promise<void> {}
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

const EXPECTED_KEYS = [
  'id',
  'name',
  'email',
  'dob',
  'zipCode',
  'createdAt',
  'lastAssessmentAt',
  'treatmentCategory',
  'matchCount',
  'isDeleted',
  'deletedAt',
].sort();

interface AdminPatientDtoShape {
  id: string;
  name: string;
  email: string;
  dob: string | null;
  zipCode: string;
  createdAt: string;
  lastAssessmentAt: string | null;
  treatmentCategory: string | null;
  matchCount: number;
  isDeleted: boolean;
  deletedAt: string | null;
}

describe('GET /admin/patients (e2e)', () => {
  let app: INestApplication;
  let tokenService: TokenServicePort;
  let adminToken: string;
  let patientToken: string;
  let csrfToken: string;

  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const seedPrisma = new PrismaClient({ adapter });

  let adminUserId: string;
  let patientUserId: string;

  const unique = Date.now();
  const oldPatientEmail = `admin-patients-e2e-old-${unique.toString()}@test.example.com`;
  const newDeletedPatientEmail = `admin-patients-e2e-deleted-${unique.toString()}@test.example.com`;
  let oldPatientUserId: string;
  let oldPatientId: string;
  let deletedPatientUserId: string;
  let deletedPatientId: string;
  let clinicId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_SENDER)
      .useValue(new StubEmailSender())
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

    const patientEmail = `admin-patients-e2e-patient-${unique.toString()}@test.example.com`;
    const patientRows = await seedPrisma.$queryRaw<{ id: string }[]>`
      SELECT create_user(${patientEmail}::citext, 'test-hash') AS id
    `;
    patientUserId = patientRows[0]!.id;

    adminToken = tokenService.issue({ sub: adminUserId, role: 'superadmin' });
    patientToken = tokenService.issue({ sub: patientUserId, role: 'patient' });

    const csrfRes = await supertest(app.getHttpServer()).get('/health');
    csrfToken = cookieValue(csrfRes.headers['set-cookie'] as unknown as string[], 'csrf_token')!;
    expect(csrfToken).toBeTruthy();

    // A minimal clinic to attach leads to (needed for matchCount).
    const clinic = await seedPrisma.clinic.create({
      data: {
        slug: `e2e-admin-patients-clinic-${unique.toString()}`,
        name: `E2E Admin Patients Clinic ${unique.toString()}`,
        rating: 0,
        reviewCount: 0,
        telehealthAvailable: false,
        financingAvailable: false,
        acceptsInsurance: false,
        status: 'active',
        billingStatus: 'no_card',
        notifyOnLead: false,
      },
      select: { id: true },
    });
    clinicId = clinic.id;

    // --- Patient 1: created earlier, active, one assessment, two leads. ---
    const oldPatientRows = await seedPrisma.$queryRaw<{ id: string }[]>`
      SELECT create_user(${oldPatientEmail}::citext, 'test-hash') AS id
    `;
    oldPatientUserId = oldPatientRows[0]!.id;
    await seedPrisma.$executeRaw`
      UPDATE users SET name = 'Old Patient' WHERE id = ${oldPatientUserId}::uuid
    `;

    const oldPatientCreated = new Date('2026-01-01T10:00:00.000Z');
    const oldPatientRow = await seedPrisma.$queryRaw<{ id: string }[]>`
      INSERT INTO patients (user_id, date_of_birth, zip_code, created_at, is_deleted)
      VALUES (${oldPatientUserId}::uuid, '1985-04-12'::date, '90210', ${oldPatientCreated}, false)
      RETURNING id::text AS id
    `;
    oldPatientId = oldPatientRow[0]!.id;

    await seedPrisma.$executeRaw`
      INSERT INTO patient_assessments (
        session_id, patient_id, treatment_category, budget_band,
        telehealth_preference, zip_code, consent_given, consent_version,
        consent_given_at, submitted_at
      ) VALUES (
        ${`e2e-admin-patients-session-${unique.toString()}`}, ${oldPatientId}::uuid,
        'hormone'::assessment_category, '$$', 'yes', '90210', true, 'v1',
        ${new Date('2026-01-02T10:00:00.000Z')}, ${new Date('2026-01-02T10:00:00.000Z')}
      )
    `;

    await seedPrisma.lead.createMany({
      data: [
        {
          leadId: `e2e-admin-patients-lead-1-${unique.toString()}`,
          clinicId,
          patientId: oldPatientId,
          patientFirstName: 'Old',
          patientEmail: oldPatientEmail,
          treatmentCategory: 'hormone',
          leadSource: 'assessment',
          deliveryStatus: 'delivered',
          clinicStatus: 'new',
          receivedAt: new Date('2026-01-03T10:00:00.000Z'),
        },
        {
          leadId: `e2e-admin-patients-lead-2-${unique.toString()}`,
          clinicId,
          patientId: oldPatientId,
          patientFirstName: 'Old',
          patientEmail: oldPatientEmail,
          treatmentCategory: 'hormone',
          leadSource: 'assessment',
          deliveryStatus: 'delivered',
          clinicStatus: 'new',
          receivedAt: new Date('2026-01-04T10:00:00.000Z'),
        },
      ],
    });

    // --- Patient 2: created later, soft-deleted, no assessments, no leads. ---
    const deletedPatientRows = await seedPrisma.$queryRaw<{ id: string }[]>`
      SELECT create_user(${newDeletedPatientEmail}::citext, 'test-hash') AS id
    `;
    deletedPatientUserId = deletedPatientRows[0]!.id;

    const deletedPatientCreated = new Date('2026-02-01T10:00:00.000Z');
    const deletedAt = new Date('2026-02-05T10:00:00.000Z');
    const deletedPatientRow = await seedPrisma.$queryRaw<{ id: string }[]>`
      INSERT INTO patients (user_id, created_at, is_deleted, deleted_at)
      VALUES (${deletedPatientUserId}::uuid, ${deletedPatientCreated}, true, ${deletedAt})
      RETURNING id::text AS id
    `;
    deletedPatientId = deletedPatientRow[0]!.id;
  });

  afterAll(async () => {
    await seedPrisma.$executeRaw`DELETE FROM leads WHERE clinic_id = ${clinicId}::uuid`;
    await seedPrisma.$executeRaw`DELETE FROM patient_assessments WHERE patient_id = ${oldPatientId}::uuid`;
    await seedPrisma.$executeRaw`DELETE FROM patients WHERE id IN (${oldPatientId}::uuid, ${deletedPatientId}::uuid)`;
    await seedPrisma.$executeRaw`DELETE FROM clinics WHERE id = ${clinicId}::uuid`;
    await seedPrisma.$executeRaw`DELETE FROM users WHERE id IN (${oldPatientUserId}::uuid, ${deletedPatientUserId}::uuid, ${patientUserId}::uuid)`;
    await app.close();
    await seedPrisma.$disconnect();
    await pool.end();
  });

  const agent = () => supertest(app.getHttpServer());

  /** Counts phi_access audit rows for the admin actor since a given timestamp. */
  async function countPhiAccessRows(since: Date): Promise<number> {
    const rows = await seedPrisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM audit_log
       WHERE action_type = 'phi_access'
         AND actor_user_id = ${adminUserId}::uuid
         AND created_at >= ${since}
    `;
    return Number(rows[0]!.count);
  }

  describe('GET /admin/patients', () => {
    it('returns 200 with an array when called with an admin token', async () => {
      const res = await agent()
        .get('/admin/patients')
        .set('Cookie', `access_token=${adminToken}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it('includes the seeded patients ordered newest-first, and does not filter out the soft-deleted one', async () => {
      const res = await agent()
        .get('/admin/patients')
        .set('Cookie', `access_token=${adminToken}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(200);

      const body = res.body as AdminPatientDtoShape[];
      const ourIds = new Set([oldPatientId, deletedPatientId]);
      const ours = body.filter((p) => ourIds.has(p.id));

      // deletedPatient was created later, so it must come first (created_at DESC).
      expect(ours.map((p) => p.id)).toEqual([deletedPatientId, oldPatientId]);

      const deleted = ours.find((p) => p.id === deletedPatientId)!;
      expect(deleted.isDeleted).toBe(true);
      expect(deleted.deletedAt).toBe('2026-02-05');
      expect(deleted.matchCount).toBe(0);
      expect(deleted.treatmentCategory).toBeNull();

      const old = ours.find((p) => p.id === oldPatientId)!;
      expect(old.isDeleted).toBe(false);
      expect(old.name).toBe('Old Patient');
      expect(old.dob).toBe('1985-04-12');
      expect(old.zipCode).toBe('90210');
      expect(old.treatmentCategory).toBe('hormone');
      expect(old.matchCount).toBe(2);

      // The full response is sorted by created_at DESC, not just our subsequence.
      const createdAts = body.map((p) => p.createdAt);
      const sorted = [...createdAts].sort().reverse();
      expect(createdAts).toEqual(sorted);
    });

    it('returns 403 when called with a patient token', async () => {
      await agent()
        .get('/admin/patients')
        .set('Cookie', `access_token=${patientToken}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(403);
    });

    it('returns 401 when called with no token', async () => {
      await agent()
        .get('/admin/patients')
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(401);
    });

    it('records a phi_access audit row for the call', async () => {
      const since = new Date();
      await new Promise((r) => setTimeout(r, 10));
      const before = await countPhiAccessRows(since);
      expect(before).toBe(0);

      await agent()
        .get('/admin/patients')
        .set('Cookie', `access_token=${adminToken}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(200);

      const after = await countPhiAccessRows(since);
      expect(after).toBe(before + 1);
    });
  });

  describe('GET /admin/patients/:id', () => {
    it('returns 200 with the matching patient, whose keys are exactly the eleven AdminPatientDto fields', async () => {
      const res = await agent()
        .get(`/admin/patients/${oldPatientId}`)
        .set('Cookie', `access_token=${adminToken}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(200);

      const body = res.body as AdminPatientDtoShape;
      expect(Object.keys(body).sort()).toEqual(EXPECTED_KEYS);

      expect(body.id).toBe(oldPatientId);
      expect(body.name).toBe('Old Patient');
      expect(body.email).toBe(oldPatientEmail);
      expect(body.dob).toBe('1985-04-12');
      expect(body.zipCode).toBe('90210');
      expect(body.treatmentCategory).toBe('hormone');
      expect(body.matchCount).toBe(2);
      expect(body.isDeleted).toBe(false);
      expect(body.deletedAt).toBeNull();
    });

    it('returns 404 with "Patient not found." for an unknown but well-formed uuid', async () => {
      const res = await agent()
        .get('/admin/patients/00000000-0000-0000-0000-000000000000')
        .set('Cookie', `access_token=${adminToken}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(404);

      const body = res.body as { error: { message: string } };
      expect(body.error.message).toBe('Patient not found.');
    });

    it('returns 400 for a malformed id', async () => {
      await agent()
        .get('/admin/patients/not-a-uuid')
        .set('Cookie', `access_token=${adminToken}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(400);
    });

    it('returns 403 when called with a patient token', async () => {
      await agent()
        .get(`/admin/patients/${oldPatientId}`)
        .set('Cookie', `access_token=${patientToken}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(403);
    });

    it('returns 401 when called with no token', async () => {
      await agent()
        .get(`/admin/patients/${oldPatientId}`)
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(401);
    });

    it('records a phi_access audit row for the call, with the patient id as the affected record', async () => {
      const since = new Date();
      await new Promise((r) => setTimeout(r, 10));
      const before = await countPhiAccessRows(since);
      expect(before).toBe(0);

      await agent()
        .get(`/admin/patients/${oldPatientId}`)
        .set('Cookie', `access_token=${adminToken}; csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .expect(200);

      const after = await countPhiAccessRows(since);
      expect(after).toBe(before + 1);

      const rows = await seedPrisma.$queryRaw<{ affected_record: string }[]>`
        SELECT affected_record FROM audit_log
         WHERE action_type = 'phi_access'
           AND actor_user_id = ${adminUserId}::uuid
           AND created_at >= ${since}
         ORDER BY created_at DESC
         LIMIT 1
      `;
      expect(rows[0]!.affected_record).toBe(oldPatientId);
    });
  });
});

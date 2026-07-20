/**
 * E2E tests for GET /admin/clinics/:id/leads, GET /admin/clinics/:id/notes,
 * and POST /admin/clinics/:id/notes.
 *
 * Strategy: boot the full AppModule, craft tokens via JwtTokenService, and
 * exercise the three routes. Mirrors test/admin/admin-clinics-read.e2e-spec.ts
 * and admin-clinics-write.e2e-spec.ts (Tasks 4-5) for auth/seeding setup.
 *
 * Covers:
 *   - GET /:id/leads returns rows whose keys are literally the mixed-case
 *     set from spec §1.4 (asserted via a sorted Object.keys comparison so a
 *     rename fails loudly), newest-first, with null patientZip as "".
 *   - POST /:id/notes returns the created AdminNote (not {success:true}),
 *     and a subsequent GET /:id/notes includes it, newest-first.
 *   - The stored authorName matches the signed-in admin's users.name, and
 *     falls back to "Admin" when the admin has no name set.
 *   - A 4001-character body returns 400; a 4000-character body succeeds.
 *   - All three routes 404 on an unknown clinic and 403 for a non-admin.
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

interface AdminNoteShape {
  id: string;
  createdAt: string;
  authorName: string;
  body: string;
}

const EXPECTED_LEAD_KEYS = [
  'lead_id',
  'received_at',
  'patientFirstName',
  'patientEmail',
  'patientZip',
  'treatmentCategory',
  'delivery_status',
  'clinic_status',
].sort();

describe('Admin clinic leads + notes endpoints (e2e)', () => {
  let app: INestApplication;
  let tokenService: TokenServicePort;
  let adminToken: string; // seeded superadmin, name = null -> "Admin" fallback
  let namedAdminToken: string; // freshly created admin with a name set
  let patientToken: string;
  let csrfToken: string;
  const createdClinicIds: string[] = [];
  const createdUserIds: string[] = [];

  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const seedPrisma = new PrismaClient({ adapter });

  let adminUserId: string;
  let namedAdminUserId: string;
  let namedAdminName: string;
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
        slug: `e2e-admin-clinic-notes-${slugSuffix}-${unique.toString()}`,
        name: `E2E Notes Clinic ${slugSuffix} ${unique.toString()}`,
        ...baseClinicData,
      },
      select: { id: true },
    });
    createdClinicIds.push(clinic.id);
    return clinic.id;
  }

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

    const adminRows = await seedPrisma.$queryRaw<{ id: string; name: string | null }[]>`
      SELECT u.id, u.name FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      WHERE u.email = 'superadmin@medalign-seed.example.com'::citext
        AND ur.role = 'superadmin'
      LIMIT 1
    `;
    if (adminRows.length === 0) {
      throw new Error('Seeded superadmin not found — run pnpm seed:pj against the test DB first.');
    }
    adminUserId = adminRows[0]!.id;
    if (adminRows[0]!.name !== null) {
      throw new Error(
        'Seeded superadmin unexpectedly has a name set; the "Admin" fallback test relies on it being null.',
      );
    }

    // A second admin with a name, to test the non-fallback path.
    const namedAdminEmail = `admin-clinic-notes-e2e-named-admin-${unique.toString()}@test.example.com`;
    namedAdminName = `Dana Reed ${unique.toString()}`;
    const namedAdminRows = await seedPrisma.$queryRaw<{ id: string }[]>`
      SELECT create_user(${namedAdminEmail}::citext, 'test-hash') AS id
    `;
    namedAdminUserId = namedAdminRows[0]!.id;
    createdUserIds.push(namedAdminUserId);
    await seedPrisma.$executeRaw`
      UPDATE users SET name = ${namedAdminName} WHERE id = ${namedAdminUserId}::uuid
    `;
    await seedPrisma.$executeRaw`
      INSERT INTO user_roles (user_id, role)
      VALUES (${namedAdminUserId}::uuid, 'admin')
      ON CONFLICT (user_id, role) DO NOTHING
    `;
    await seedPrisma.$executeRaw`
      DELETE FROM user_roles WHERE user_id = ${namedAdminUserId}::uuid AND role = 'patient'
    `;

    const patientEmail = `admin-clinic-notes-e2e-patient-${unique.toString()}@test.example.com`;
    const patientRows = await seedPrisma.$queryRaw<{ id: string }[]>`
      SELECT create_user(${patientEmail}::citext, 'test-hash') AS id
    `;
    patientUserId = patientRows[0]!.id;
    createdUserIds.push(patientUserId);

    adminToken = tokenService.issue({ sub: adminUserId, role: 'superadmin' });
    namedAdminToken = tokenService.issue({ sub: namedAdminUserId, role: 'admin' });
    patientToken = tokenService.issue({ sub: patientUserId, role: 'patient' });

    const csrfRes = await supertest(app.getHttpServer()).get('/health');
    csrfToken = cookieValue(csrfRes.headers['set-cookie'] as unknown as string[], 'csrf_token')!;
    expect(csrfToken).toBeTruthy();
  });

  afterAll(async () => {
    for (const id of createdClinicIds) {
      await seedPrisma.$executeRaw`DELETE FROM admin_notes WHERE clinic_id = ${id}::uuid`;
      await seedPrisma.$executeRaw`DELETE FROM leads WHERE clinic_id = ${id}::uuid`;
      await seedPrisma.$executeRaw`DELETE FROM clinics WHERE id = ${id}::uuid`;
    }
    for (const id of createdUserIds) {
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
  const namedAdminHeaders = () => ({
    Cookie: `access_token=${namedAdminToken}; csrf_token=${csrfToken}`,
    'x-csrf-token': csrfToken,
  });
  const patientHeaders = () => ({
    Cookie: `access_token=${patientToken}; csrf_token=${csrfToken}`,
    'x-csrf-token': csrfToken,
  });
  const unknownId = '00000000-0000-0000-0000-000000000000';

  describe('GET /admin/clinics/:id/leads', () => {
    it('returns leads with exactly the mixed-case keys, newest-first, and "" for a null zip', async () => {
      const id = await createClinic('leads');

      await seedPrisma.lead.createMany({
        data: [
          {
            leadId: `e2e-notes-lead-older-${unique.toString()}`,
            clinicId: id,
            patientFirstName: 'Pat',
            patientEmail: `pat-${unique.toString()}@test.example.com`,
            patientZip: '78701',
            treatmentCategory: 'hormone',
            leadSource: 'assessment',
            deliveryStatus: 'delivered',
            clinicStatus: 'new',
            receivedAt: new Date('2026-01-01T10:00:00.000Z'),
          },
          {
            leadId: `e2e-notes-lead-newer-${unique.toString()}`,
            clinicId: id,
            patientFirstName: 'Sam',
            patientEmail: `sam-${unique.toString()}@test.example.com`,
            patientZip: null,
            treatmentCategory: 'peptide',
            leadSource: 'assessment',
            deliveryStatus: 'pending',
            clinicStatus: 'contacted',
            receivedAt: new Date('2026-02-15T10:00:00.000Z'),
          },
        ],
      });

      const res = await agent().get(`/admin/clinics/${id}/leads`).set(adminHeaders()).expect(200);

      const body = res.body as Record<string, unknown>[];
      expect(body).toHaveLength(2);

      // Literal key-set assertion: a renamed/added/dropped field fails loudly.
      expect(Object.keys(body[0]!).sort()).toEqual(EXPECTED_LEAD_KEYS);
      expect(Object.keys(body[1]!).sort()).toEqual(EXPECTED_LEAD_KEYS);

      // Newest first.
      expect(body[0]!['patientFirstName']).toBe('Sam');
      expect(body[1]!['patientFirstName']).toBe('Pat');

      // ISO 8601 round-trip.
      expect(body[0]!['received_at']).toBe('2026-02-15T10:00:00.000Z');

      // null patientZip serializes as "".
      expect(body[0]!['patientZip']).toBe('');
      expect(body[1]!['patientZip']).toBe('78701');

      expect(body[0]!['delivery_status']).toBe('pending');
      expect(body[0]!['clinic_status']).toBe('contacted');
      expect(body[0]!['treatmentCategory']).toBe('peptide');
      expect(typeof body[0]!['lead_id']).toBe('string');
    });

    it('returns 404 with "Clinic not found." for an unknown clinic', async () => {
      const res = await agent()
        .get(`/admin/clinics/${unknownId}/leads`)
        .set(adminHeaders())
        .expect(404);
      const body = res.body as { error: { message: string } };
      expect(body.error.message).toBe('Clinic not found.');
    });

    it('returns 403 for a non-admin', async () => {
      const id = await createClinic('leads-forbidden');
      await agent().get(`/admin/clinics/${id}/leads`).set(patientHeaders()).expect(403);
    });
  });

  describe('GET /admin/clinics/:id/notes + POST /admin/clinics/:id/notes', () => {
    it('creates a note (returning it, not {success:true}) and lists it newest-first with the fallback author name', async () => {
      const id = await createClinic('notes-fallback');

      const postRes = await agent()
        .post(`/admin/clinics/${id}/notes`)
        .set(adminHeaders())
        .send({ body: 'First note' })
        .expect((res) => {
          if (res.status !== 200 && res.status !== 201) {
            throw new Error(`expected 200 or 201, got ${res.status.toString()}`);
          }
        });

      const created = postRes.body as AdminNoteShape;
      expect(created).not.toEqual({ success: true });
      expect(created.body).toBe('First note');
      expect(created.authorName).toBe('Admin'); // seeded superadmin has no name
      expect(typeof created.id).toBe('string');
      expect(typeof created.createdAt).toBe('string');
      expect(new Date(created.createdAt).toISOString()).toBe(created.createdAt);

      // A second note, to assert newest-first ordering.
      const secondRes = await agent()
        .post(`/admin/clinics/${id}/notes`)
        .set(adminHeaders())
        .send({ body: 'Second note' });
      const second = secondRes.body as AdminNoteShape;

      const listRes = await agent()
        .get(`/admin/clinics/${id}/notes`)
        .set(adminHeaders())
        .expect(200);
      const notes = listRes.body as AdminNoteShape[];
      expect(notes.map((n) => n.id)).toEqual([second.id, created.id]);
      expect(notes[0]!.authorName).toBe('Admin');
      expect(Object.keys(notes[0]!).sort()).toEqual(
        ['id', 'createdAt', 'authorName', 'body'].sort(),
      );
    });

    it("stores the signed-in admin's users.name as authorName when set", async () => {
      const id = await createClinic('notes-named');

      const res = await agent()
        .post(`/admin/clinics/${id}/notes`)
        .set(namedAdminHeaders())
        .send({ body: 'Named admin note' });

      const created = res.body as AdminNoteShape;
      expect(created.authorName).toBe(namedAdminName);

      const listRes = await agent()
        .get(`/admin/clinics/${id}/notes`)
        .set(adminHeaders())
        .expect(200);
      const notes = listRes.body as AdminNoteShape[];
      expect(notes[0]!.authorName).toBe(namedAdminName);
    });

    it('rejects a caller-supplied authorName field (whitelist strips/rejects unknown properties)', async () => {
      const id = await createClinic('notes-spoof');

      await agent()
        .post(`/admin/clinics/${id}/notes`)
        .set(adminHeaders())
        .send({ body: 'Spoof attempt', authorName: 'Not The Admin', author_user_id: 'x' })
        .expect(400);
    });

    it('accepts a 4000-character body and rejects a 4001-character body', async () => {
      const id = await createClinic('notes-length');

      await agent()
        .post(`/admin/clinics/${id}/notes`)
        .set(adminHeaders())
        .send({ body: 'a'.repeat(4000) })
        .expect((res) => {
          if (res.status !== 200 && res.status !== 201) {
            throw new Error(`expected 200 or 201, got ${res.status.toString()}`);
          }
        });

      await agent()
        .post(`/admin/clinics/${id}/notes`)
        .set(adminHeaders())
        .send({ body: 'a'.repeat(4001) })
        .expect(400);
    });

    it('rejects an empty body', async () => {
      const id = await createClinic('notes-empty');
      await agent()
        .post(`/admin/clinics/${id}/notes`)
        .set(adminHeaders())
        .send({ body: '' })
        .expect(400);
    });

    it('returns 404 with "Clinic not found." for GET and POST on an unknown clinic', async () => {
      const getRes = await agent()
        .get(`/admin/clinics/${unknownId}/notes`)
        .set(adminHeaders())
        .expect(404);
      expect((getRes.body as { error: { message: string } }).error.message).toBe(
        'Clinic not found.',
      );

      const postRes = await agent()
        .post(`/admin/clinics/${unknownId}/notes`)
        .set(adminHeaders())
        .send({ body: 'x' })
        .expect(404);
      expect((postRes.body as { error: { message: string } }).error.message).toBe(
        'Clinic not found.',
      );
    });

    it('returns 403 for a non-admin on both routes', async () => {
      const id = await createClinic('notes-forbidden');
      await agent().get(`/admin/clinics/${id}/notes`).set(patientHeaders()).expect(403);
      await agent()
        .post(`/admin/clinics/${id}/notes`)
        .set(patientHeaders())
        .send({ body: 'x' })
        .expect(403);
    });
  });
});

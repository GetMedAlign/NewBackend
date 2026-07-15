/**
 * Integration test: verifies admin RLS policies for clinic_applications,
 * application_categories, application_services, and admin write-provisioning
 * on clinic tables (clinics, clinic_categories, clinic_services, clinic_photos).
 *
 * Seeding via asSystem (superuser, bypasses RLS). Scoped reads/writes via
 * withUserContext (runs as app_authenticated with appropriate context vars set).
 *
 * Requires a real Postgres instance — DATABASE_URL loaded from test/.env.test.
 */

import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

let service: PrismaService;

let adminId: string;
let patientId: string;
let patientUserId: string;
let clinicId: string;
let appId: string;

beforeAll(async () => {
  service = new PrismaService();
  await service.onModuleInit();

  // Clean slate
  await service.asSystem((client) => client.$executeRaw`TRUNCATE users RESTART IDENTITY CASCADE`);
  await service.asSystem((client) => client.$executeRaw`TRUNCATE clinics RESTART IDENTITY CASCADE`);

  // Seed admin user: create_user gives 'patient' role by default; replace with 'admin'.
  const adminRows = await service.asSystem(
    (client) => client.$queryRaw<{ id: string }[]>`
      SELECT create_user('admin@app.test'::citext, 'h') AS id
    `,
  );
  adminId = adminRows[0]!.id;

  await service.asSystem(
    (client) => client.$executeRaw`
      DELETE FROM user_roles WHERE user_id = ${adminId}::uuid AND role = 'patient'::app_role
    `,
  );
  await service.asSystem(
    (client) => client.$executeRaw`
      INSERT INTO user_roles (user_id, role) VALUES (${adminId}::uuid, 'admin'::app_role)
    `,
  );

  // Seed plain patient user
  const patientUserRows = await service.asSystem(
    (client) => client.$queryRaw<{ id: string }[]>`
      SELECT create_user('patient@app.test'::citext, 'h') AS id
    `,
  );
  patientUserId = patientUserRows[0]!.id;

  const patientRows = await service.asSystem(
    (client) => client.$queryRaw<{ id: string }[]>`
      INSERT INTO patients (user_id) VALUES (${patientUserId}::uuid) RETURNING id
    `,
  );
  patientId = patientRows[0]!.id;

  // Seed a clinic (for the clinic-context non-admin probe)
  const clinicRows = await service.asSystem(
    (client) => client.$queryRaw<{ id: string }[]>`
      INSERT INTO clinics (
        slug, name, rating, review_count, telehealth_available,
        financing_available, accepts_insurance, status, billing_status, notify_on_lead
      )
      VALUES (
        'existing-clinic', 'Existing Clinic', 4.0, 5, false,
        false, false, 'active', 'current', false
      )
      RETURNING id
    `,
  );
  clinicId = clinicRows[0]!.id;
});

afterAll(async () => {
  await service.asSystem((client) => client.$executeRaw`TRUNCATE users RESTART IDENTITY CASCADE`);
  await service.asSystem((client) => client.$executeRaw`TRUNCATE clinics RESTART IDENTITY CASCADE`);
  await service.onModuleDestroy();
});

// ---------------------------------------------------------------------------
// Admin can INSERT/SELECT clinic_applications and child rows
// ---------------------------------------------------------------------------
describe('admin context — clinic_applications access', () => {
  it('admin can INSERT a clinic_applications row', async () => {
    const rows = await service.withUserContext(
      { userId: adminId, role: 'admin', ip: null },
      (tx) => tx.$queryRaw<{ id: string }[]>`
        INSERT INTO clinic_applications (clinic_name, contact_email)
        VALUES ('Test Clinic App', 'test@clinic.test')
        RETURNING id
      `,
    );
    expect(rows).toHaveLength(1);
    appId = rows[0]!.id;
  });

  it('admin can SELECT the inserted clinic_applications row', async () => {
    const rows = await service.withUserContext(
      { userId: adminId, role: 'admin', ip: null },
      (tx) => tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM clinic_applications WHERE id = ${appId}::uuid
      `,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(appId);
  });

  it('admin can INSERT an application_categories row', async () => {
    await expect(
      service.withUserContext(
        { userId: adminId, role: 'admin', ip: null },
        (tx) => tx.$executeRaw`
          INSERT INTO application_categories (application_id, category)
          VALUES (${appId}::uuid, 'hormone'::assessment_category)
        `,
      ),
    ).resolves.not.toThrow();
  });

  it('admin can INSERT an application_services row', async () => {
    await expect(
      service.withUserContext(
        { userId: adminId, role: 'admin', ip: null },
        (tx) => tx.$executeRaw`
          INSERT INTO application_services (application_id, service_code, is_top_service, display_order)
          VALUES (${appId}::uuid, 'svc-001', false, 1)
        `,
      ),
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Admin can INSERT into clinic tables (provisioning path)
// ---------------------------------------------------------------------------
describe('admin context — clinic provisioning writes', () => {
  let provisionedClinicId: string;

  it('admin can INSERT a clinics row', async () => {
    const rows = await service.withUserContext(
      { userId: adminId, role: 'admin', ip: null },
      (tx) => tx.$queryRaw<{ id: string }[]>`
        INSERT INTO clinics (
          slug, name, rating, review_count, telehealth_available,
          financing_available, accepts_insurance, status, billing_status, notify_on_lead
        )
        VALUES (
          'provisioned-clinic', 'Provisioned Clinic', 0, 0, false,
          false, false, 'pending', 'current', false
        )
        RETURNING id
      `,
    );
    expect(rows).toHaveLength(1);
    provisionedClinicId = rows[0]!.id;
  });

  it('admin can INSERT a clinic_categories row for the provisioned clinic', async () => {
    await expect(
      service.withUserContext(
        { userId: adminId, role: 'admin', ip: null },
        (tx) => tx.$executeRaw`
          INSERT INTO clinic_categories (clinic_id, category)
          VALUES (${provisionedClinicId}::uuid, 'hormone'::assessment_category)
        `,
      ),
    ).resolves.not.toThrow();
  });

  it('admin can INSERT a clinic_services row for the provisioned clinic', async () => {
    await expect(
      service.withUserContext(
        { userId: adminId, role: 'admin', ip: null },
        (tx) => tx.$executeRaw`
          INSERT INTO clinic_services (clinic_id, service_code, is_top_service, display_order)
          VALUES (${provisionedClinicId}::uuid, 'svc-001', false, 1)
        `,
      ),
    ).resolves.not.toThrow();
  });

  it('admin can INSERT a clinic_photos row for the provisioned clinic', async () => {
    await expect(
      service.withUserContext(
        { userId: adminId, role: 'admin', ip: null },
        (tx) => tx.$executeRaw`
          INSERT INTO clinic_photos (clinic_id, url, display_order)
          VALUES (${provisionedClinicId}::uuid, 'https://photos.example.com/new.jpg', 1)
        `,
      ),
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Non-admin: clinic context — clinic_applications locked out
// ---------------------------------------------------------------------------
describe('clinic context — clinic_applications locked out', () => {
  it('clinic context SELECT clinic_applications returns 0 rows', async () => {
    const rows = await service.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId },
      (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id FROM clinic_applications`,
    );
    expect(rows).toHaveLength(0);
  });

  it('clinic context INSERT into clinic_applications is REJECTED', async () => {
    await expect(
      service.withUserContext(
        { userId: null, role: 'clinic', ip: null, clinicId },
        (tx) => tx.$executeRaw`
          INSERT INTO clinic_applications (clinic_name, contact_email)
          VALUES ('Sneaky Clinic', 'sneaky@clinic.test')
        `,
      ),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Non-admin: patient context — clinic_applications locked out
// ---------------------------------------------------------------------------
describe('patient context — clinic_applications locked out', () => {
  it('patient context SELECT clinic_applications returns 0 rows', async () => {
    const rows = await service.withUserContext(
      { userId: patientUserId, role: 'patient', ip: null },
      (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id FROM clinic_applications`,
    );
    expect(rows).toHaveLength(0);
  });

  it('patient context INSERT into clinic_applications is REJECTED', async () => {
    await expect(
      service.withUserContext(
        { userId: patientUserId, role: 'patient', ip: null },
        (tx) => tx.$executeRaw`
          INSERT INTO clinic_applications (clinic_name, contact_email)
          VALUES ('Patient Hack', 'hack@patient.test')
        `,
      ),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Sanity: existing clinic + patient RLS unaffected
// ---------------------------------------------------------------------------
describe('sanity — existing RLS policies unaffected', () => {
  it('clinic context can still read its own clinic row (clinic_self_select intact)', async () => {
    const rows = await service.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId },
      (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id FROM clinics WHERE id = ${clinicId}::uuid`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(clinicId);
  });

  it('patient context can still read its own patient row (patients_self_select intact)', async () => {
    const rows = await service.withUserContext(
      { userId: patientUserId, role: 'patient', ip: null },
      (tx) => tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM patients WHERE id = ${patientId}::uuid
      `,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(patientId);
  });
});

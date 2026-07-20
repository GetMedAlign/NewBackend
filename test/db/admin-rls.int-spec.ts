/**
 * Integration test: verifies admin RLS policies for admin_notes, and admin
 * read access on patients, patient_assessments, and leads.
 *
 * Seeding via asSystem (superuser, bypasses RLS). Scoped reads/writes via
 * withUserContext (runs as app_authenticated with appropriate context vars set).
 *
 * Requires a real Postgres instance — DATABASE_URL loaded from test/.env.test.
 */

import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

let service: PrismaService;

let adminId: string;
let patientAUserId: string;
let patientAId: string;
let patientBUserId: string;
let patientBId: string;
let clinicId: string;
let assessmentId: string;
let leadId: string;

async function createUser(email: string): Promise<string> {
  const rows = await service.asSystem(
    (client) => client.$queryRaw<{ id: string }[]>`
      SELECT create_user(${email}::citext, 'h') AS id
    `,
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`create_user did not return an id for ${email}`);
  return id;
}

async function createPatient(uid: string): Promise<string> {
  const rows = await service.asSystem(
    (client) => client.$queryRaw<{ id: string }[]>`
      INSERT INTO patients (user_id)
      VALUES (${uid}::uuid)
      RETURNING id
    `,
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`could not create patient for user ${uid}`);
  return id;
}

beforeAll(async () => {
  service = new PrismaService();
  await service.onModuleInit();

  // Clean slate
  await service.asSystem((client) => client.$executeRaw`TRUNCATE users RESTART IDENTITY CASCADE`);
  await service.asSystem((client) => client.$executeRaw`TRUNCATE clinics RESTART IDENTITY CASCADE`);

  // Seed admin user: create_user gives 'patient' role by default; replace with 'admin'.
  adminId = await createUser('admin@app.test');
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

  // Seed patient A and patient B
  patientAUserId = await createUser('patient-a@app.test');
  patientAId = await createPatient(patientAUserId);

  patientBUserId = await createUser('patient-b@app.test');
  patientBId = await createPatient(patientBUserId);

  // Seed a clinic (for the clinic-context probe and admin_notes FK)
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

  // Seed a patient_assessments row tied to patient A
  const assessmentRows = await service.asSystem(
    (client) => client.$queryRaw<{ id: string }[]>`
      INSERT INTO patient_assessments (
        session_id, patient_id, treatment_category, budget_band,
        telehealth_preference, zip_code, consent_given, consent_version,
        consent_given_at, submitted_at
      )
      VALUES (
        'session-admin-rls-1', ${patientAId}::uuid, 'hormone'::assessment_category, '200_500',
        'either', '10001', true, 'v1',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING id
    `,
  );
  assessmentId = assessmentRows[0]!.id;

  // Seed a leads row tied to patient A and the clinic
  const leadRows = await service.asSystem(
    (client) => client.$queryRaw<{ id: string }[]>`
      INSERT INTO leads (
        lead_id, clinic_id, patient_id, patient_first_name, patient_email,
        treatment_category, lead_source, delivery_status, clinic_status, received_at
      )
      VALUES (
        'lead-admin-rls-1', ${clinicId}::uuid, ${patientAId}::uuid, 'First', 'lead@x.com',
        'hormone', 'assessment', 'pending', 'new', CURRENT_TIMESTAMP
      )
      RETURNING id
    `,
  );
  leadId = leadRows[0]!.id;
});

afterAll(async () => {
  await service.asSystem((client) => client.$executeRaw`TRUNCATE users RESTART IDENTITY CASCADE`);
  await service.asSystem((client) => client.$executeRaw`TRUNCATE clinics RESTART IDENTITY CASCADE`);
  await service.onModuleDestroy();
});

// ---------------------------------------------------------------------------
// Admin context — can read the patient-journey tables and manage admin_notes
// ---------------------------------------------------------------------------
describe('admin context — patient-journey reads', () => {
  it('admin SELECT on patients returns the seeded rows', async () => {
    const rows = await service.withUserContext(
      { userId: adminId, role: 'admin', ip: null },
      (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id FROM patients ORDER BY id`,
    );
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual([patientAId, patientBId].sort());
  });

  it('admin SELECT on patient_assessments returns the seeded row', async () => {
    const rows = await service.withUserContext(
      { userId: adminId, role: 'admin', ip: null },
      (tx) =>
        tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM patient_assessments WHERE id = ${assessmentId}::uuid`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(assessmentId);
  });

  it('admin SELECT on leads returns the seeded row', async () => {
    const rows = await service.withUserContext(
      { userId: adminId, role: 'admin', ip: null },
      (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id FROM leads WHERE id = ${leadId}::uuid`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(leadId);
  });
});

describe('admin context — admin_notes access', () => {
  let noteId: string;

  it('admin INSERT into admin_notes succeeds', async () => {
    const rows = await service.withUserContext(
      { userId: adminId, role: 'admin', ip: null },
      (tx) => tx.$queryRaw<{ id: string }[]>`
        INSERT INTO admin_notes (clinic_id, author_user_id, author_name, body)
        VALUES (${clinicId}::uuid, ${adminId}::uuid, 'Admin Name', 'A note about this clinic')
        RETURNING id
      `,
    );
    expect(rows).toHaveLength(1);
    noteId = rows[0]!.id;
  });

  it('admin SELECT returns the inserted admin_notes row', async () => {
    const rows = await service.withUserContext(
      { userId: adminId, role: 'admin', ip: null },
      (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id FROM admin_notes WHERE id = ${noteId}::uuid`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(noteId);
  });
});

// ---------------------------------------------------------------------------
// Clinic context — locked out of admin_notes
// ---------------------------------------------------------------------------
describe('clinic context — admin_notes locked out', () => {
  it('clinic context SELECT admin_notes returns 0 rows', async () => {
    const rows = await service.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId },
      (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id FROM admin_notes`,
    );
    expect(rows).toHaveLength(0);
  });

  it('clinic context INSERT into admin_notes is REJECTED', async () => {
    await expect(
      service.withUserContext(
        { userId: null, role: 'clinic', ip: null, clinicId },
        (tx) => tx.$executeRaw`
          INSERT INTO admin_notes (clinic_id, author_user_id, author_name, body)
          VALUES (${clinicId}::uuid, ${adminId}::uuid, 'Sneaky Clinic', 'Not allowed')
        `,
      ),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Patient context — locked out of admin_notes, scoped to own patient row
// ---------------------------------------------------------------------------
describe('patient context — admin_notes locked out, patients scoped to self', () => {
  it('patient context SELECT admin_notes returns 0 rows', async () => {
    const rows = await service.withUserContext(
      { userId: patientAUserId, role: 'patient', ip: null },
      (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id FROM admin_notes`,
    );
    expect(rows).toHaveLength(0);
  });

  it('patient context SELECT patients returns only patient A row, not patient B', async () => {
    const rows = await service.withUserContext(
      { userId: patientAUserId, role: 'patient', ip: null },
      (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id FROM patients`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(patientAId);
  });
});

// ---------------------------------------------------------------------------
// Anonymous context (no userId) — locked out of admin_notes
// ---------------------------------------------------------------------------
describe('anonymous context — admin_notes locked out', () => {
  it('anonymous context SELECT admin_notes returns 0 rows', async () => {
    const rows = await service.withUserContext(
      { userId: null, role: null, ip: null },
      (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id FROM admin_notes`,
    );
    expect(rows).toHaveLength(0);
  });
});

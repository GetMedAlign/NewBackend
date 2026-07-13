/**
 * Integration test: verifies Row-Level Security is enforced on the
 * patient-journey tables (patients, patient_assessments, leads). Seeding
 * happens via asSystem (superuser, bypasses RLS); scoped reads happen via
 * withUserContext (runs as app_authenticated).
 *
 * Requires a real Postgres instance — DATABASE_URL loaded from test/.env.test.
 */

import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

let service: PrismaService;

let userA: string;
let userB: string;
let userAdmin: string;

let patientA: string;
let patientB: string;

let assessmentA: string;
let assessmentB: string;
let assessmentAnon: string;

let leadA: string;
let leadB: string;

let clinicId: string;

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

async function createAssessment(sessionId: string, patientId: string | null): Promise<string> {
  const rows = await service.asSystem(
    (client) => client.$queryRaw<{ id: string }[]>`
      INSERT INTO patient_assessments (
        session_id, patient_id, treatment_category, budget_band,
        telehealth_preference, zip_code, consent_given, consent_version,
        consent_given_at, submitted_at
      )
      VALUES (
        ${sessionId}, ${patientId}::uuid, 'hormone'::assessment_category, '200_500',
        'either', '10001', true, 'v1',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING id
    `,
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`could not create assessment ${sessionId}`);
  return id;
}

async function createLead(leadIdStr: string, patientId: string): Promise<string> {
  const rows = await service.asSystem(
    (client) => client.$queryRaw<{ id: string }[]>`
      INSERT INTO leads (
        lead_id, clinic_id, patient_id, patient_first_name, patient_email,
        treatment_category, lead_source, delivery_status, clinic_status, received_at
      )
      VALUES (
        ${leadIdStr}, ${clinicId}::uuid, ${patientId}::uuid, 'First', 'lead@x.com',
        'hormone', 'assessment', 'pending', 'new', CURRENT_TIMESTAMP
      )
      RETURNING id
    `,
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`could not create lead ${leadIdStr}`);
  return id;
}

beforeAll(async () => {
  service = new PrismaService();
  await service.onModuleInit();

  // Clean slate for deterministic assertions.
  await service.asSystem((client) => client.$executeRaw`TRUNCATE users RESTART IDENTITY CASCADE`);
  await service.asSystem((client) => client.$executeRaw`TRUNCATE clinics RESTART IDENTITY CASCADE`);

  userA = await createUser('a@x.com');
  userB = await createUser('b@x.com');
  userAdmin = await createUser('admin@x.com');

  await service.asSystem(
    (client) => client.$executeRaw`
      INSERT INTO user_roles (user_id, role) VALUES (${userAdmin}::uuid, 'admin'::app_role)
    `,
  );

  const clinicRows = await service.asSystem(
    (client) => client.$queryRaw<{ id: string }[]>`
      INSERT INTO clinics (
        slug, name, rating, review_count, telehealth_available, financing_available,
        accepts_insurance, status, billing_status, notify_on_lead
      )
      VALUES ('clinic-a', 'Clinic A', 4.5, 10, true, false, false, 'active', 'current', false)
      RETURNING id
    `,
  );
  clinicId = clinicRows[0]!.id;

  patientA = await createPatient(userA);
  patientB = await createPatient(userB);

  assessmentA = await createAssessment('session_a'.padEnd(40, '0'), patientA);
  assessmentB = await createAssessment('session_b'.padEnd(40, '0'), patientB);
  assessmentAnon = await createAssessment('session_anon'.padEnd(40, '0'), null);

  leadA = await createLead('lead_a'.padEnd(37, '0'), patientA);
  leadB = await createLead('lead_b'.padEnd(37, '0'), patientB);
});

afterAll(async () => {
  await service.asSystem((client) => client.$executeRaw`TRUNCATE users RESTART IDENTITY CASCADE`);
  await service.asSystem((client) => client.$executeRaw`TRUNCATE clinics RESTART IDENTITY CASCADE`);
  await service.onModuleDestroy();
});

describe('patient-journey RLS enforcement', () => {
  it('patient A sees only their own patient row', async () => {
    const rows = await service.withUserContext({ userId: userA, role: 'patient', ip: null }, (tx) =>
      tx.patient.findMany(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(patientA);
  });

  it('patient A cannot read patient B via findUnique', async () => {
    const row = await service.withUserContext({ userId: userA, role: 'patient', ip: null }, (tx) =>
      tx.patient.findUnique({ where: { id: patientB } }),
    );
    expect(row).toBeNull();
  });

  it('patient A sees only their own assessment (not B, not anonymous)', async () => {
    const rows = await service.withUserContext({ userId: userA, role: 'patient', ip: null }, (tx) =>
      tx.patientAssessment.findMany(),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual([assessmentA]);
    expect(ids).not.toContain(assessmentB);
    expect(ids).not.toContain(assessmentAnon);
  });

  it("patient A cannot read patient B's assessment via findUnique", async () => {
    const row = await service.withUserContext({ userId: userA, role: 'patient', ip: null }, (tx) =>
      tx.patientAssessment.findUnique({ where: { id: assessmentB } }),
    );
    expect(row).toBeNull();
  });

  it('the anonymous assessment is invisible to patient A', async () => {
    const row = await service.withUserContext({ userId: userA, role: 'patient', ip: null }, (tx) =>
      tx.patientAssessment.findUnique({ where: { id: assessmentAnon } }),
    );
    expect(row).toBeNull();
  });

  it('patient A sees only their own lead', async () => {
    const rows = await service.withUserContext({ userId: userA, role: 'patient', ip: null }, (tx) =>
      tx.lead.findMany(),
    );
    expect(rows.map((r) => r.id)).toEqual([leadA]);
  });

  it("patient A cannot read patient B's lead via findUnique", async () => {
    const row = await service.withUserContext({ userId: userA, role: 'patient', ip: null }, (tx) =>
      tx.lead.findUnique({ where: { id: leadB } }),
    );
    expect(row).toBeNull();
  });

  it('admin sees all patients, assessments (incl. anonymous), and leads', async () => {
    const ctx = { userId: userAdmin, role: 'admin', ip: null };

    const patients = await service.withUserContext(ctx, (tx) => tx.patient.findMany());
    expect(patients.map((r) => r.id).sort()).toEqual([patientA, patientB].sort());

    const assessments = await service.withUserContext(ctx, (tx) => tx.patientAssessment.findMany());
    expect(assessments.map((r) => r.id).sort()).toEqual(
      [assessmentA, assessmentB, assessmentAnon].sort(),
    );

    const leads = await service.withUserContext(ctx, (tx) => tx.lead.findMany());
    expect(leads.map((r) => r.id).sort()).toEqual([leadA, leadB].sort());
  });

  it('the anonymous assessment is reachable via asSystem', async () => {
    const row = await service.asSystem((client) =>
      client.patientAssessment.findUnique({ where: { id: assessmentAnon } }),
    );
    expect(row?.id).toBe(assessmentAnon);
  });

  it('clinics are readable by any authenticated patient (public reference data)', async () => {
    const rows = await service.withUserContext({ userId: userA, role: 'patient', ip: null }, (tx) =>
      tx.clinic.findMany(),
    );
    expect(rows.map((r) => r.id)).toContain(clinicId);
  });
});

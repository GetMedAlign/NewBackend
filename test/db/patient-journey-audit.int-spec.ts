/**
 * Integration test: verifies DB-side audit triggers on patient-journey tables
 * write audit_log rows with the acting user's context, that encrypted/PHI
 * free-text is stripped from the captured jsonb, and that app_authenticated
 * cannot write audit_log directly.
 *
 * Requires a real Postgres instance — DATABASE_URL loaded from test/.env.test.
 */

import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

let service: PrismaService;

let userA: string;
let userAdmin: string;
let patientA: string;
let assessmentA: string;
let leadA: string;
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

beforeAll(async () => {
  service = new PrismaService();
  await service.onModuleInit();

  await service.asSystem((client) => client.$executeRaw`TRUNCATE users RESTART IDENTITY CASCADE`);
  await service.asSystem((client) => client.$executeRaw`TRUNCATE clinics RESTART IDENTITY CASCADE`);
  await service.asSystem(
    (client) => client.$executeRaw`TRUNCATE audit_log RESTART IDENTITY CASCADE`,
  );

  userA = await createUser('a@x.com');
  userAdmin = await createUser('admin@x.com');

  await service.asSystem(
    (client) => client.$executeRaw`
      INSERT INTO user_roles (user_id, role) VALUES (${userAdmin}::uuid, 'admin'::app_role)
    `,
  );

  const patientRows = await service.asSystem(
    (client) => client.$queryRaw<{ id: string }[]>`
      INSERT INTO patients (user_id) VALUES (${userA}::uuid) RETURNING id
    `,
  );
  patientA = patientRows[0]!.id;

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

  const assessmentRows = await service.asSystem(
    (client) => client.$queryRaw<{ id: string }[]>`
      INSERT INTO patient_assessments (
        session_id, patient_id, treatment_category, budget_band,
        telehealth_preference, zip_code, consent_given, consent_version,
        consent_given_at, submitted_at, allergy_details, other_medications
      )
      VALUES (
        ${'session_a'.padEnd(40, '0')}, ${patientA}::uuid, 'hormone'::assessment_category,
        '200_500', 'either', '10001', true, 'v1',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'ENC:allergy', 'ENC:meds'
      )
      RETURNING id
    `,
  );
  assessmentA = assessmentRows[0]!.id;

  const leadRows = await service.asSystem(
    (client) => client.$queryRaw<{ id: string }[]>`
      INSERT INTO leads (
        lead_id, clinic_id, patient_id, patient_first_name, patient_email,
        treatment_category, lead_source, delivery_status, clinic_status, received_at, patient_phone
      )
      VALUES (
        ${'lead_a'.padEnd(37, '0')}, ${clinicId}::uuid, ${patientA}::uuid, 'First', 'lead@x.com',
        'hormone', 'assessment', 'pending', 'new', CURRENT_TIMESTAMP, 'ENC:phone'
      )
      RETURNING id
    `,
  );
  leadA = leadRows[0]!.id;
});

afterAll(async () => {
  await service.asSystem((client) => client.$executeRaw`TRUNCATE users RESTART IDENTITY CASCADE`);
  await service.asSystem((client) => client.$executeRaw`TRUNCATE clinics RESTART IDENTITY CASCADE`);
  await service.asSystem(
    (client) => client.$executeRaw`TRUNCATE audit_log RESTART IDENTITY CASCADE`,
  );
  await service.onModuleDestroy();
});

async function latestAudit(actionType: string) {
  const rows = await service.asSystem(
    (client) => client.$queryRaw<
      {
        actor_user_id: string;
        action_type: string;
        affected_record: string;
        new_value: Record<string, unknown>;
      }[]
    >`
      SELECT actor_user_id, action_type, affected_record, new_value
      FROM audit_log
      WHERE action_type = ${actionType}
      ORDER BY created_at DESC
      LIMIT 1
    `,
  );
  return rows[0];
}

describe('patient-journey audit triggers', () => {
  it('records an assessment_updated row with actor context and no encrypted PHI free-text', async () => {
    await service.withUserContext({ userId: userA, role: 'patient', ip: '203.0.113.7' }, (tx) =>
      tx.patientAssessment.update({
        where: { id: assessmentA },
        data: { startTimeline: 'asap' },
      }),
    );

    const row = await latestAudit('assessment_updated');
    expect(row).toBeDefined();
    expect(row?.actor_user_id).toBe(userA);
    expect(row?.affected_record).toBe(`patient_assessments:${assessmentA}`);
    expect(row?.new_value).toBeDefined();
    expect(row?.new_value).not.toHaveProperty('allergy_details');
    expect(row?.new_value).not.toHaveProperty('other_medications');
  });

  it('records a lead_updated row with actor context and no patient_phone', async () => {
    // Per spec §4, patients have SELECT-only on leads; mutation is admin (clinic
    // access is a later slice), so the update runs under the admin context.
    await service.withUserContext({ userId: userAdmin, role: 'admin', ip: '203.0.113.7' }, (tx) =>
      tx.lead.update({
        where: { id: leadA },
        data: { clinicStatus: 'contacted' },
      }),
    );

    const row = await latestAudit('lead_updated');
    expect(row).toBeDefined();
    expect(row?.actor_user_id).toBe(userAdmin);
    expect(row?.affected_record).toBe(`leads:${leadA}`);
    expect(row?.new_value).toBeDefined();
    expect(row?.new_value).not.toHaveProperty('patient_phone');
  });

  it('records a patient_updated row with actor context', async () => {
    await service.withUserContext({ userId: userA, role: 'patient', ip: '203.0.113.7' }, (tx) =>
      tx.patient.update({
        where: { id: patientA },
        data: { zipCode: '10001' },
      }),
    );

    const row = await latestAudit('patient_updated');
    expect(row).toBeDefined();
    expect(row?.actor_user_id).toBe(userA);
    expect(row?.affected_record).toBe(`patients:${patientA}`);
  });

  it('denies a direct audit_log insert from app_authenticated', async () => {
    await expect(
      service.withUserContext(
        { userId: userA, role: 'patient', ip: null },
        (tx) => tx.$executeRaw`
          INSERT INTO audit_log (actor_role, action_type, affected_record)
          VALUES ('patient', 'hack', 'patients:x')
        `,
      ),
    ).rejects.toThrow();
  });
});

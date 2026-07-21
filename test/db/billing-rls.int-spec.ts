/**
 * Integration test: verifies clinic- and admin-scoped Row-Level Security on
 * billing_profiles and invoices. A clinic sees only its own billing profile
 * and invoices (and may write only its own billing_profiles row; invoices are
 * clinic-read-only). An admin sees and writes all rows. Patients and
 * anonymous callers see nothing.
 *
 * Seeding happens via asSystem (superuser, bypasses RLS) so the existence of
 * the fixture rows does not depend on the policies under test. Scoped
 * reads/writes happen via withUserContext (runs as app_authenticated with the
 * appropriate session vars set).
 *
 * Requires a real Postgres instance — DATABASE_URL loaded from test/.env.test.
 */

import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

let service: PrismaService;

let clinicAId: string;
let clinicBId: string;
let adminId: string;
let patientUserId: string;
let billingProfileAId: string;
let invoiceAId: string;

beforeAll(async () => {
  service = new PrismaService();
  await service.onModuleInit();

  // Clean slate
  await service.asSystem((client) => client.$executeRaw`TRUNCATE users RESTART IDENTITY CASCADE`);
  await service.asSystem((client) => client.$executeRaw`TRUNCATE clinics RESTART IDENTITY CASCADE`);

  // Seed clinic A and clinic B
  const clinicARows = await service.asSystem(
    (client) => client.$queryRaw<{ id: string }[]>`
      INSERT INTO clinics (
        slug, name, rating, review_count, telehealth_available, financing_available,
        accepts_insurance, status, billing_status, notify_on_lead
      )
      VALUES ('billing-clinic-a', 'Billing Clinic A', 4.5, 10, true, false, false, 'active', 'current', false)
      RETURNING id
    `,
  );
  clinicAId = clinicARows[0]!.id;

  const clinicBRows = await service.asSystem(
    (client) => client.$queryRaw<{ id: string }[]>`
      INSERT INTO clinics (
        slug, name, rating, review_count, telehealth_available, financing_available,
        accepts_insurance, status, billing_status, notify_on_lead
      )
      VALUES ('billing-clinic-b', 'Billing Clinic B', 3.8, 5, false, false, false, 'active', 'current', false)
      RETURNING id
    `,
  );
  clinicBId = clinicBRows[0]!.id;

  // Seed admin user
  const adminRows = await service.asSystem(
    (client) => client.$queryRaw<{ id: string }[]>`
      SELECT create_user('billing-admin@app.test'::citext, 'h') AS id
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

  // Seed patient user (default 'patient' role from create_user)
  const patientRows = await service.asSystem(
    (client) => client.$queryRaw<{ id: string }[]>`
      SELECT create_user('billing-patient@app.test'::citext, 'h') AS id
    `,
  );
  patientUserId = patientRows[0]!.id;

  // Seed a billing_profiles row for clinic A (via asSystem — bypasses RLS, so
  // its existence does NOT depend on the policy under test).
  const billingProfileRows = await service.asSystem(
    (client) => client.$queryRaw<{ id: string }[]>`
      INSERT INTO billing_profiles (clinic_id, billing_email, billing_contact_name)
      VALUES (${clinicAId}::uuid, 'billing-a@x.com', 'Clinic A Billing Contact')
      RETURNING id
    `,
  );
  billingProfileAId = billingProfileRows[0]!.id;

  // Seed an invoices row for clinic A (via asSystem).
  const invoiceRows = await service.asSystem(
    (client) => client.$queryRaw<{ id: string }[]>`
      INSERT INTO invoices (
        clinic_id, period_start, period_end, lead_count, price_per_lead, platform_fee, total_amount, status
      )
      VALUES (
        ${clinicAId}::uuid, '2026-06-01T00:00:00Z', '2026-06-30T23:59:59Z', 10, 50.00, 25.00, 525.00, 'draft'
      )
      RETURNING id
    `,
  );
  invoiceAId = invoiceRows[0]!.id;
});

afterAll(async () => {
  await service.asSystem((client) => client.$executeRaw`TRUNCATE users RESTART IDENTITY CASCADE`);
  await service.asSystem((client) => client.$executeRaw`TRUNCATE clinics RESTART IDENTITY CASCADE`);
  await service.onModuleDestroy();
});

// ---------------------------------------------------------------------------
// Clinic context
// ---------------------------------------------------------------------------
describe('clinic context — billing_profiles and invoices scoped to own clinic', () => {
  it('clinic A SELECT billing_profiles WHERE clinic_id = A returns the seeded row', async () => {
    const rows = await service.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId: clinicAId },
      (tx) =>
        tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM billing_profiles WHERE clinic_id = ${clinicAId}::uuid
        `,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(billingProfileAId);
  });

  it('clinic A SELECT billing_profiles WHERE clinic_id = B returns 0 rows', async () => {
    const rows = await service.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId: clinicAId },
      (tx) =>
        tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM billing_profiles WHERE clinic_id = ${clinicBId}::uuid
        `,
    );
    expect(rows).toHaveLength(0);
  });

  it('clinic A INSERT a billing_profiles row for clinic A succeeds', async () => {
    // Clinic A doesn't yet have a second row (unique clinic_id), so use a
    // fresh clinic C to prove the INSERT path itself works under WITH CHECK
    // without violating the clinic_id uniqueness constraint on clinic A.
    const clinicCRows = await service.asSystem(
      (client) => client.$queryRaw<{ id: string }[]>`
        INSERT INTO clinics (
          slug, name, rating, review_count, telehealth_available, financing_available,
          accepts_insurance, status, billing_status, notify_on_lead
        )
        VALUES ('billing-clinic-c', 'Billing Clinic C', 4.0, 1, false, false, false, 'active', 'current', false)
        RETURNING id
      `,
    );
    const clinicCId = clinicCRows[0]!.id;

    await expect(
      service.withUserContext(
        { userId: null, role: 'clinic', ip: null, clinicId: clinicCId },
        (tx) => tx.$executeRaw`
          INSERT INTO billing_profiles (clinic_id, billing_email)
          VALUES (${clinicCId}::uuid, 'billing-c@x.com')
        `,
      ),
    ).resolves.not.toThrow();
  });

  it('clinic A INSERT a billing_profiles row for clinic B is rejected', async () => {
    await expect(
      service.withUserContext(
        { userId: null, role: 'clinic', ip: null, clinicId: clinicAId },
        (tx) => tx.$executeRaw`
          INSERT INTO billing_profiles (clinic_id, billing_email)
          VALUES (${clinicBId}::uuid, 'hacked@x.com')
        `,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('clinic A SELECT invoices WHERE clinic_id = A returns the seeded row', async () => {
    const rows = await service.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId: clinicAId },
      (tx) =>
        tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM invoices WHERE clinic_id = ${clinicAId}::uuid`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(invoiceAId);
  });

  it('clinic A SELECT invoices WHERE clinic_id = B returns 0 rows', async () => {
    const rows = await service.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId: clinicAId },
      (tx) =>
        tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM invoices WHERE clinic_id = ${clinicBId}::uuid`,
    );
    expect(rows).toHaveLength(0);
  });

  it('clinic A INSERT into invoices is REJECTED (no clinic insert policy)', async () => {
    await expect(
      service.withUserContext(
        { userId: null, role: 'clinic', ip: null, clinicId: clinicAId },
        (tx) => tx.$executeRaw`
          INSERT INTO invoices (
            clinic_id, period_start, period_end, lead_count, price_per_lead, platform_fee, total_amount, status
          )
          VALUES (
            ${clinicAId}::uuid, '2026-07-01T00:00:00Z', '2026-07-31T23:59:59Z', 5, 50.00, 25.00, 275.00, 'draft'
          )
        `,
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

// ---------------------------------------------------------------------------
// Admin context
// ---------------------------------------------------------------------------
describe('admin context — full access to billing_profiles and invoices', () => {
  it('admin SELECT billing_profiles for clinic A returns the seeded row', async () => {
    const rows = await service.withUserContext(
      { userId: adminId, role: 'admin', ip: null },
      (tx) =>
        tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM billing_profiles WHERE clinic_id = ${clinicAId}::uuid
        `,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(billingProfileAId);
  });

  it('admin SELECT invoices for clinic A returns the seeded row', async () => {
    const rows = await service.withUserContext(
      { userId: adminId, role: 'admin', ip: null },
      (tx) =>
        tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM invoices WHERE clinic_id = ${clinicAId}::uuid`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(invoiceAId);
  });

  it('admin INSERT an invoices row for clinic A succeeds', async () => {
    const rows = await service.withUserContext(
      { userId: adminId, role: 'admin', ip: null },
      (tx) => tx.$queryRaw<{ id: string }[]>`
        INSERT INTO invoices (
          clinic_id, period_start, period_end, lead_count, price_per_lead, platform_fee, total_amount, status
        )
        VALUES (
          ${clinicAId}::uuid, '2026-07-01T00:00:00Z', '2026-07-31T23:59:59Z', 5, 50.00, 25.00, 275.00, 'draft'
        )
        RETURNING id
      `,
    );
    expect(rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Patient context — locked out
// ---------------------------------------------------------------------------
describe('patient context — billing_profiles and invoices locked out', () => {
  it('patient SELECT billing_profiles returns 0 rows (seeded row is invisible)', async () => {
    const rows = await service.withUserContext(
      { userId: patientUserId, role: 'patient', ip: null },
      (tx) =>
        tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM billing_profiles WHERE id = ${billingProfileAId}::uuid`,
    );
    expect(rows).toHaveLength(0);
  });

  it('patient SELECT invoices returns 0 rows (seeded row is invisible)', async () => {
    const rows = await service.withUserContext(
      { userId: patientUserId, role: 'patient', ip: null },
      (tx) =>
        tx.$queryRaw<{ id: string }[]>`SELECT id FROM invoices WHERE id = ${invoiceAId}::uuid`,
    );
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Anonymous context — locked out
// ---------------------------------------------------------------------------
describe('anonymous context — billing_profiles and invoices locked out', () => {
  it('anonymous SELECT billing_profiles returns 0 rows (seeded row is invisible)', async () => {
    const rows = await service.withUserContext(
      { userId: null, role: null, ip: null },
      (tx) =>
        tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM billing_profiles WHERE id = ${billingProfileAId}::uuid`,
    );
    expect(rows).toHaveLength(0);
  });

  it('anonymous SELECT invoices returns 0 rows (seeded row is invisible)', async () => {
    const rows = await service.withUserContext(
      { userId: null, role: null, ip: null },
      (tx) =>
        tx.$queryRaw<{ id: string }[]>`SELECT id FROM invoices WHERE id = ${invoiceAId}::uuid`,
    );
    expect(rows).toHaveLength(0);
  });
});

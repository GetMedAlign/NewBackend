/**
 * Integration test: verifies clinic-scoped Row-Level Security is enforced on
 * clinics, leads, webhook_deliveries, and clinic_photos. Seeding happens via
 * asSystem (superuser, bypasses RLS); scoped reads/writes happen via
 * withUserContext (runs as app_authenticated with app.current_clinic_id set).
 *
 * Requires a real Postgres instance — DATABASE_URL loaded from test/.env.test.
 */

import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

let service: PrismaService;

// Clinic IDs
let clinicAId: string;
let clinicBId: string;

// Lead IDs
let leadAId: string;
let leadBId: string;

// Webhook delivery IDs
let deliveryAId: string;
let deliveryBId: string;

// Clinic photo IDs
let photoAId: string;
let photoBId: string;

// Patient context data (for sanity check)
let userAId: string;
let patientAId: string;
let leadForPatientAId: string;

beforeAll(async () => {
  service = new PrismaService();
  await service.onModuleInit();

  // Clean slate — cascade clears leads, clinic_photos, webhook_deliveries, patients, etc.
  await service.asSystem((client) => client.$executeRaw`TRUNCATE users RESTART IDENTITY CASCADE`);
  await service.asSystem((client) => client.$executeRaw`TRUNCATE clinics RESTART IDENTITY CASCADE`);

  // Seed clinic A
  const clinicARows = await service.asSystem(
    (client) => client.$queryRaw<{ id: string }[]>`
      INSERT INTO clinics (
        slug, name, rating, review_count, telehealth_available, financing_available,
        accepts_insurance, status, billing_status, notify_on_lead
      )
      VALUES ('clinic-a', 'Clinic A', 4.5, 10, true, false, false, 'active', 'current', false)
      RETURNING id
    `,
  );
  clinicAId = clinicARows[0]!.id;

  // Seed clinic B
  const clinicBRows = await service.asSystem(
    (client) => client.$queryRaw<{ id: string }[]>`
      INSERT INTO clinics (
        slug, name, rating, review_count, telehealth_available, financing_available,
        accepts_insurance, status, billing_status, notify_on_lead
      )
      VALUES ('clinic-b', 'Clinic B', 3.8, 5, false, false, false, 'active', 'current', false)
      RETURNING id
    `,
  );
  clinicBId = clinicBRows[0]!.id;

  // Seed user A + patient A (for patient sanity check)
  const userARows = await service.asSystem(
    (client) => client.$queryRaw<{ id: string }[]>`
      SELECT create_user('patient-a@x.com'::citext, 'h') AS id
    `,
  );
  userAId = userARows[0]!.id;

  const patientARows = await service.asSystem(
    (client) => client.$queryRaw<{ id: string }[]>`
      INSERT INTO patients (user_id) VALUES (${userAId}::uuid) RETURNING id
    `,
  );
  patientAId = patientARows[0]!.id;

  // Seed lead for clinic A (linked to patient A)
  const leadARows = await service.asSystem(
    (client) => client.$queryRaw<{ id: string }[]>`
      INSERT INTO leads (
        lead_id, clinic_id, patient_id, patient_first_name, patient_email,
        treatment_category, lead_source, delivery_status, clinic_status, received_at
      )
      VALUES (
        'lead-clinic-a-0000000000000000000000000000000',
        ${clinicAId}::uuid,
        ${patientAId}::uuid,
        'Alice', 'alice@x.com',
        'hormone', 'assessment', 'pending', 'new', CURRENT_TIMESTAMP
      )
      RETURNING id
    `,
  );
  leadAId = leadARows[0]!.id;
  leadForPatientAId = leadAId;

  // Seed lead for clinic B (no patient link needed)
  const leadBRows = await service.asSystem(
    (client) => client.$queryRaw<{ id: string }[]>`
      INSERT INTO leads (
        lead_id, clinic_id, patient_first_name, patient_email,
        treatment_category, lead_source, delivery_status, clinic_status, received_at
      )
      VALUES (
        'lead-clinic-b-0000000000000000000000000000000',
        ${clinicBId}::uuid,
        'Bob', 'bob@x.com',
        'hormone', 'assessment', 'pending', 'new', CURRENT_TIMESTAMP
      )
      RETURNING id
    `,
  );
  leadBId = leadBRows[0]!.id;

  // Seed webhook delivery for clinic A's lead
  const deliveryARows = await service.asSystem(
    (client) => client.$queryRaw<{ id: string }[]>`
      INSERT INTO webhook_deliveries (lead_id, url, status, attempted_at)
      VALUES (${leadAId}::uuid, 'https://a.example.com/hook', 'success', CURRENT_TIMESTAMP)
      RETURNING id
    `,
  );
  deliveryAId = deliveryARows[0]!.id;

  // Seed webhook delivery for clinic B's lead
  const deliveryBRows = await service.asSystem(
    (client) => client.$queryRaw<{ id: string }[]>`
      INSERT INTO webhook_deliveries (lead_id, url, status, attempted_at)
      VALUES (${leadBId}::uuid, 'https://b.example.com/hook', 'success', CURRENT_TIMESTAMP)
      RETURNING id
    `,
  );
  deliveryBId = deliveryBRows[0]!.id;

  // Seed clinic photo for clinic A
  const photoARows = await service.asSystem(
    (client) => client.$queryRaw<{ id: string }[]>`
      INSERT INTO clinic_photos (clinic_id, url, display_order)
      VALUES (${clinicAId}::uuid, 'https://photos.example.com/a.jpg', 1)
      RETURNING id
    `,
  );
  photoAId = photoARows[0]!.id;

  // Seed clinic photo for clinic B
  const photoBRows = await service.asSystem(
    (client) => client.$queryRaw<{ id: string }[]>`
      INSERT INTO clinic_photos (clinic_id, url, display_order)
      VALUES (${clinicBId}::uuid, 'https://photos.example.com/b.jpg', 1)
      RETURNING id
    `,
  );
  photoBId = photoBRows[0]!.id;
});

afterAll(async () => {
  await service.asSystem((client) => client.$executeRaw`TRUNCATE users RESTART IDENTITY CASCADE`);
  await service.asSystem((client) => client.$executeRaw`TRUNCATE clinics RESTART IDENTITY CASCADE`);
  await service.onModuleDestroy();
});

describe('clinic-portal RLS enforcement', () => {
  // -------------------------------------------------------------------------
  // Clinic row isolation
  // -------------------------------------------------------------------------
  it('clinic A context reads its own clinic row', async () => {
    const rows = await service.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId: clinicAId },
      (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id FROM clinics WHERE id = ${clinicAId}::uuid`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(clinicAId);
  });

  it('clinic A context cannot read clinic B row via self-select policy (but public-read still applies)', async () => {
    // The clinics_public_select policy allows reading all clinics.
    // The clinic_self_select policy is in addition. Both clinics are visible
    // to any authenticated app_authenticated caller via the public read policy.
    // This verifies clinic B row IS visible (public read) — the self policies
    // add UPDATE capability, not SELECT restriction.
    const rows = await service.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId: clinicAId },
      (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id FROM clinics WHERE id = ${clinicBId}::uuid`,
    );
    // Public read policy is still in place; clinic B is readable.
    expect(rows).toHaveLength(1);
  });

  it('clinic A context can UPDATE its own clinic row (via clinic_self_update policy)', async () => {
    await expect(
      service.withUserContext(
        { userId: null, role: 'clinic', ip: null, clinicId: clinicAId },
        (tx) =>
          tx.$executeRaw`UPDATE clinics SET location = 'New York' WHERE id = ${clinicAId}::uuid`,
      ),
    ).resolves.not.toThrow();
  });

  it('clinic A context CANNOT UPDATE clinic B row (RLS blocks it)', async () => {
    // The update silently affects 0 rows because the RLS USING clause
    // filters out clinic B for clinic A context.
    const affected = await service.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId: clinicAId },
      (tx) =>
        tx.$executeRaw`UPDATE clinics SET location = 'Los Angeles' WHERE id = ${clinicBId}::uuid`,
    );
    // Prisma returns the count of affected rows; should be 0 (filtered by RLS).
    expect(Number(affected)).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Leads isolation
  // -------------------------------------------------------------------------
  it('clinic A context reads only its own lead', async () => {
    const rows = await service.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId: clinicAId },
      (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id FROM leads`,
    );
    expect(rows.map((r) => r.id)).toEqual([leadAId]);
    expect(rows.map((r) => r.id)).not.toContain(leadBId);
  });

  it('clinic A context cannot read clinic B lead by id', async () => {
    const rows = await service.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId: clinicAId },
      (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id FROM leads WHERE id = ${leadBId}::uuid`,
    );
    expect(rows).toHaveLength(0);
  });

  it('clinic A context can update its own lead clinic_status', async () => {
    await expect(
      service.withUserContext(
        { userId: null, role: 'clinic', ip: null, clinicId: clinicAId },
        (tx) =>
          tx.$executeRaw`UPDATE leads SET clinic_status = 'contacted' WHERE id = ${leadAId}::uuid`,
      ),
    ).resolves.not.toThrow();

    // Verify the update took effect
    const rows = await service.asSystem(
      (client) =>
        client.$queryRaw<{ clinic_status: string }[]>`
          SELECT clinic_status FROM leads WHERE id = ${leadAId}::uuid
        `,
    );
    expect(rows[0]?.clinic_status).toBe('contacted');
  });

  it('clinic A context is REJECTED when trying to UPDATE a non-clinic_status column on leads', async () => {
    // The column-level grant only allows UPDATE (clinic_status), so attempting
    // to write patient_email must throw a permission/privilege error.
    await expect(
      service.withUserContext(
        { userId: null, role: 'clinic', ip: null, clinicId: clinicAId },
        (tx) =>
          tx.$executeRaw`UPDATE leads SET patient_email = 'hacked@x.com' WHERE id = ${leadAId}::uuid`,
      ),
    ).rejects.toThrow();
  });

  it('clinic B context reading clinic A lead returns 0 rows', async () => {
    const rows = await service.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId: clinicBId },
      (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id FROM leads WHERE id = ${leadAId}::uuid`,
    );
    expect(rows).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Webhook deliveries isolation
  // -------------------------------------------------------------------------
  it('clinic A context reads only its own webhook deliveries', async () => {
    const rows = await service.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId: clinicAId },
      (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id FROM webhook_deliveries`,
    );
    expect(rows.map((r) => r.id)).toEqual([deliveryAId]);
    expect(rows.map((r) => r.id)).not.toContain(deliveryBId);
  });

  it('clinic A context cannot read clinic B webhook delivery by id', async () => {
    const rows = await service.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId: clinicAId },
      (tx) =>
        tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM webhook_deliveries WHERE id = ${deliveryBId}::uuid
        `,
    );
    expect(rows).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Clinic photos isolation
  // -------------------------------------------------------------------------
  it('clinic A context reads only its own clinic photos', async () => {
    const rows = await service.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId: clinicAId },
      (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id FROM clinic_photos`,
    );
    expect(rows.map((r) => r.id)).toEqual([photoAId]);
    expect(rows.map((r) => r.id)).not.toContain(photoBId);
  });

  it('clinic A context cannot read clinic B photo by id', async () => {
    const rows = await service.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId: clinicAId },
      (tx) =>
        tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM clinic_photos WHERE id = ${photoBId}::uuid
        `,
    );
    expect(rows).toHaveLength(0);
  });

  it('clinic A context can insert a photo for itself', async () => {
    await expect(
      service.withUserContext(
        { userId: null, role: 'clinic', ip: null, clinicId: clinicAId },
        (tx) =>
          tx.$executeRaw`
            INSERT INTO clinic_photos (clinic_id, url, display_order)
            VALUES (${clinicAId}::uuid, 'https://photos.example.com/a2.jpg', 2)
          `,
      ),
    ).resolves.not.toThrow();
  });

  it('clinic A context CANNOT insert a photo for clinic B (WITH CHECK rejects it)', async () => {
    await expect(
      service.withUserContext(
        { userId: null, role: 'clinic', ip: null, clinicId: clinicAId },
        (tx) =>
          tx.$executeRaw`
            INSERT INTO clinic_photos (clinic_id, url, display_order)
            VALUES (${clinicBId}::uuid, 'https://photos.example.com/hacked.jpg', 99)
          `,
      ),
    ).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // Sanity: existing patient RLS is unaffected
  // -------------------------------------------------------------------------
  it('patient context (user_id set) can still read its own lead (patient RLS intact)', async () => {
    const rows = await service.withUserContext(
      { userId: userAId, role: 'patient', ip: null },
      (tx) =>
        tx.$queryRaw<{ id: string }[]>`SELECT id FROM leads WHERE id = ${leadForPatientAId}::uuid`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(leadForPatientAId);
  });

  it('when clinicId is not set, clinic_id session var is empty → no clinic rows visible via clinic policies', async () => {
    // A patient context has clinicId unset (defaults to ''), so the empty-var
    // idiom nullif(..., '')::uuid yields NULL and clinic self-select matches
    // nothing. The public-read SELECT policy still allows reading clinics.
    // What matters: no clinic update is possible because clinic_self_update
    // would also yield NULL and filter everything.
    const affected = await service.withUserContext(
      { userId: userAId, role: 'patient', ip: null },
      (tx) => tx.$executeRaw`UPDATE clinics SET location = 'Nowhere' WHERE id = ${clinicAId}::uuid`,
    );
    expect(Number(affected)).toBe(0);
  });
});

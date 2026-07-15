/**
 * Integration tests for PrismaClinicLeadRepository against a live Postgres.
 * DATABASE_URL is loaded from test/.env.test via jest.int.config.ts setupFiles.
 *
 * Verifies:
 *  - listByClinic returns leads scoped to the caller clinic
 *  - findByClinic returns the correct lead for the caller clinic
 *  - updateStatus persists the change and only touches clinic_status
 *  - RLS cross-context: clinic B cannot read or status-update clinic A's lead
 */
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PrismaClinicLeadRepository } from '../../src/modules/clinic-portal/infrastructure/prisma-clinic-lead.repository';
import { seedPatientJourney } from '../../prisma/seed/patient-journey.seed';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const adapter = new PrismaPg(pool);
const seedPrisma = new PrismaClient({ adapter });

let prismaService: PrismaService;
let repo: PrismaClinicLeadRepository;
let clinicAId: string;
let clinicBId: string;

// Lead IDs seeded in beforeAll for testing
let leadAId: string; // belongs to clinic A (vitality)
let leadBId: string; // belongs to clinic B (apex)

// The text lead_id (business key) for lookup
const LEAD_A_BUSINESS_ID = 'int-spec-lead-clinic-a-0000000000001';
const LEAD_B_BUSINESS_ID = 'int-spec-lead-clinic-b-0000000000001';

beforeAll(async () => {
  await seedPatientJourney(seedPrisma);

  const clinicA = await seedPrisma.clinic.findUniqueOrThrow({
    where: { slug: 'vitality-hormone-nyc' },
    select: { id: true },
  });
  clinicAId = clinicA.id;

  const clinicB = await seedPrisma.clinic.findUniqueOrThrow({
    where: { slug: 'apex-peptide-telehealth' },
    select: { id: true },
  });
  clinicBId = clinicB.id;

  prismaService = new PrismaService();
  await prismaService.onModuleInit();
  repo = new PrismaClinicLeadRepository(prismaService);

  // Insert a lead for clinic A
  const rowsA = await prismaService.asSystem(
    (client) => client.$queryRaw<{ id: string }[]>`
      INSERT INTO leads (
        lead_id, clinic_id, patient_first_name, patient_email,
        patient_zip, treatment_category, top_goals, top_symptoms,
        budget_band, telehealth_preference, start_timeline,
        lead_source, delivery_status, clinic_status, received_at
      )
      VALUES (
        ${LEAD_A_BUSINESS_ID},
        ${clinicAId}::uuid,
        'Alice', 'alice@leads-int-spec.example.com',
        '10001', 'hormone', 'energy,mood', 'fatigue',
        '$100-200/mo', 'yes', 'immediately',
        'assessment', 'delivered', 'new', NOW()
      )
      ON CONFLICT (lead_id) DO UPDATE
        SET clinic_id = EXCLUDED.clinic_id
      RETURNING id
    `,
  );
  leadAId = rowsA[0]!.id;

  // Insert a lead for clinic B
  const rowsB = await prismaService.asSystem(
    (client) => client.$queryRaw<{ id: string }[]>`
      INSERT INTO leads (
        lead_id, clinic_id, patient_first_name, patient_email,
        treatment_category, lead_source, delivery_status, clinic_status, received_at
      )
      VALUES (
        ${LEAD_B_BUSINESS_ID},
        ${clinicBId}::uuid,
        'Bob', 'bob@leads-int-spec.example.com',
        'hormone', 'assessment', 'pending', 'new', NOW()
      )
      ON CONFLICT (lead_id) DO UPDATE
        SET clinic_id = EXCLUDED.clinic_id
      RETURNING id
    `,
  );
  leadBId = rowsB[0]!.id;
});

afterAll(async () => {
  await prismaService.asSystem(
    (client) =>
      client.$executeRaw`DELETE FROM leads WHERE id IN (${leadAId}::uuid, ${leadBId}::uuid)`,
  );
  await seedPatientJourney(seedPrisma);
  await prismaService.onModuleDestroy();
  await seedPrisma.$disconnect();
  await pool.end();
});

describe('PrismaClinicLeadRepository.listByClinic', () => {
  it('returns leads belonging to clinic A', async () => {
    const leads = await repo.listByClinic(clinicAId);

    expect(Array.isArray(leads)).toBe(true);
    const ourLead = leads.find((l) => l.leadId === LEAD_A_BUSINESS_ID);
    expect(ourLead).toBeDefined();
    expect(ourLead!.patientFirstName).toBe('Alice');
    expect(ourLead!.patientEmail).toBe('alice@leads-int-spec.example.com');
    expect(ourLead!.patientZip).toBe('10001');
    expect(ourLead!.treatmentCategory).toBe('hormone');
    expect(ourLead!.clinicId).toBe(clinicAId);
    expect(ourLead!.clinicName).toBeTruthy();
  });

  it('does not include clinic B leads when listing for clinic A (RLS)', async () => {
    const leads = await repo.listByClinic(clinicAId);

    const leakLead = leads.find((l) => l.leadId === LEAD_B_BUSINESS_ID);
    expect(leakLead).toBeUndefined();
  });

  it('returns leads for clinic B scoped to B only', async () => {
    const leads = await repo.listByClinic(clinicBId);

    const ourLead = leads.find((l) => l.leadId === LEAD_B_BUSINESS_ID);
    expect(ourLead).toBeDefined();

    const leakLead = leads.find((l) => l.leadId === LEAD_A_BUSINESS_ID);
    expect(leakLead).toBeUndefined();
  });
});

describe('PrismaClinicLeadRepository.findByClinic', () => {
  it('returns a lead owned by clinic A', async () => {
    const lead = await repo.findByClinic(clinicAId, LEAD_A_BUSINESS_ID);

    expect(lead).not.toBeNull();
    expect(lead!.leadId).toBe(LEAD_A_BUSINESS_ID);
    expect(lead!.patientEmail).toBe('alice@leads-int-spec.example.com');
  });

  it('returns null for a lead that belongs to clinic B (cross-context probe)', async () => {
    // Clinic A context tries to read clinic B's lead by B's business key
    const lead = await repo.findByClinic(clinicAId, LEAD_B_BUSINESS_ID);
    expect(lead).toBeNull();
  });

  it('returns null for an unknown leadId', async () => {
    const lead = await repo.findByClinic(clinicAId, 'nonexistent-lead-id');
    expect(lead).toBeNull();
  });
});

describe('PrismaClinicLeadRepository.updateStatus', () => {
  it('updates clinic_status and returns true for clinic A own lead', async () => {
    const result = await repo.updateStatus(clinicAId, LEAD_A_BUSINESS_ID, 'contacted');

    expect(result).toBe(true);

    // Verify the change persisted
    const lead = await repo.findByClinic(clinicAId, LEAD_A_BUSINESS_ID);
    expect(lead!.clinicStatus).toBe('contacted');
  });

  it('does not update any other column — only clinic_status changes', async () => {
    const before = await repo.findByClinic(clinicAId, LEAD_A_BUSINESS_ID);

    await repo.updateStatus(clinicAId, LEAD_A_BUSINESS_ID, 'booked');

    const after = await repo.findByClinic(clinicAId, LEAD_A_BUSINESS_ID);

    expect(after!.clinicStatus).toBe('booked');
    // All other fields must be unchanged
    expect(after!.patientFirstName).toBe(before!.patientFirstName);
    expect(after!.patientEmail).toBe(before!.patientEmail);
    expect(after!.leadSource).toBe(before!.leadSource);
    expect(after!.deliveryStatus).toBe(before!.deliveryStatus);
    expect(after!.treatmentCategory).toBe(before!.treatmentCategory);
  });

  it('returns false when lead does not belong to clinic (cross-context: 0 rows updated)', async () => {
    // Clinic A context tries to update clinic B's lead — RLS blocks the UPDATE
    const result = await repo.updateStatus(clinicAId, LEAD_B_BUSINESS_ID, 'converted');

    expect(result).toBe(false);

    // Clinic B's lead must be unchanged
    const lead = await repo.findByClinic(clinicBId, LEAD_B_BUSINESS_ID);
    expect(lead!.clinicStatus).toBe('new');
  });

  it('returns false for a completely unknown leadId', async () => {
    const result = await repo.updateStatus(clinicAId, 'no-such-lead-id', 'contacted');
    expect(result).toBe(false);
  });
});

describe('RLS cross-context direct probe', () => {
  /**
   * Uses prismaService.withUserContext directly to confirm that clinic A's
   * context genuinely cannot see clinic B's lead row.
   */
  it('clinic A withUserContext cannot SELECT clinic B lead by its internal UUID', async () => {
    const rows = await prismaService.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId: clinicAId },
      (tx) =>
        tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM leads WHERE id = ${leadBId}::uuid
        `,
    );

    expect(rows).toHaveLength(0);
  });
});

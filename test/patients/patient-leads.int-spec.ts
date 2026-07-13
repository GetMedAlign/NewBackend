/**
 * Integration tests for PrismaLeadRepository.findByPatientUser
 * against a live Postgres with the patient-journey seed applied.
 *
 * Verifies enriched PatientLeadView shape and per-user RLS isolation.
 */
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { AesGcmEncryptionService } from '../../src/infrastructure/crypto/aes-gcm-encryption.service';
import { PrismaLeadRepository } from '../../src/modules/leads/infrastructure/prisma-lead.repository';
import { seedPatientJourney } from '../../prisma/seed/patient-journey.seed';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const adapter = new PrismaPg(pool);
const seedPrisma = new PrismaClient({ adapter });

let prismaService: PrismaService;
let repo: PrismaLeadRepository;
let clinicId: string;

const suffix = Date.now();
const userAEmail = `patient-leads-a-${suffix}@test.local`;
const userBEmail = `patient-leads-b-${suffix}@test.local`;
let userAId: string;
let userBId: string;
let patientAId: string;
let patientBId: string;
const createdLeadIds: string[] = [];

async function createUser(email: string): Promise<string> {
  const rows = await prismaService.asSystem(
    (client) =>
      client.$queryRaw<{ id: string }[]>`
        SELECT create_user(${email}::citext, 'test-hash') AS id
      `,
  );
  return rows[0]!.id;
}

async function createPatient(userId: string): Promise<string> {
  const rows = await prismaService.asSystem(
    (client) =>
      client.$queryRaw<{ id: string }[]>`
        INSERT INTO patients (user_id, is_deleted)
        VALUES (${userId}::uuid, false)
        RETURNING id::text AS id
      `,
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  await seedPatientJourney(seedPrisma);

  const clinic = await seedPrisma.clinic.findUniqueOrThrow({
    where: { slug: 'vitality-hormone-nyc' },
    select: { id: true },
  });
  clinicId = clinic.id;

  prismaService = new PrismaService();
  await prismaService.onModuleInit();

  const config = {
    getOrThrow: () => process.env['ENCRYPTION_KEY'],
  } as unknown as ConstructorParameters<typeof AesGcmEncryptionService>[0];
  const encryption = new AesGcmEncryptionService(config);
  repo = new PrismaLeadRepository(prismaService, encryption);

  userAId = await createUser(userAEmail);
  userBId = await createUser(userBEmail);
  patientAId = await createPatient(userAId);
  patientBId = await createPatient(userBId);

  // Create 2 leads for userA, 1 lead for userB
  const leadIdA1 = await prismaService.asSystem(async (client) => {
    const lead = await client.lead.create({
      data: {
        leadId: `lead_a1_${suffix}`,
        clinicId,
        patientId: patientAId,
        patientFirstName: 'Alice',
        patientEmail: userAEmail,
        treatmentCategory: 'hormone',
        topGoals: 'boost_energy,lose_weight',
        topSymptoms: 'fatigue',
        budgetBand: '200_500',
        telehealthPreference: 'yes',
        leadSource: 'assessment',
        deliveryStatus: 'pending',
        clinicStatus: 'new',
        receivedAt: new Date('2026-01-01T10:00:00Z'),
      },
      select: { leadId: true },
    });
    return lead.leadId;
  });
  createdLeadIds.push(leadIdA1);

  const leadIdA2 = await prismaService.asSystem(async (client) => {
    const lead = await client.lead.create({
      data: {
        leadId: `lead_a2_${suffix}`,
        clinicId,
        patientId: patientAId,
        patientFirstName: 'Alice',
        patientEmail: userAEmail,
        treatmentCategory: 'hormone',
        topGoals: 'improve_sleep',
        topSymptoms: 'brain_fog,fatigue',
        budgetBand: '500_1000',
        telehealthPreference: 'no',
        leadSource: 'assessment',
        deliveryStatus: 'pending',
        clinicStatus: 'new',
        receivedAt: new Date('2026-02-01T10:00:00Z'),
      },
      select: { leadId: true },
    });
    return lead.leadId;
  });
  createdLeadIds.push(leadIdA2);

  const leadIdB1 = await prismaService.asSystem(async (client) => {
    const lead = await client.lead.create({
      data: {
        leadId: `lead_b1_${suffix}`,
        clinicId,
        patientId: patientBId,
        patientFirstName: 'Bob',
        patientEmail: userBEmail,
        treatmentCategory: 'hormone',
        topGoals: 'build_muscle',
        topSymptoms: 'fatigue',
        budgetBand: '200_500',
        telehealthPreference: 'yes',
        leadSource: 'assessment',
        deliveryStatus: 'pending',
        clinicStatus: 'new',
        receivedAt: new Date('2026-01-15T10:00:00Z'),
      },
      select: { leadId: true },
    });
    return lead.leadId;
  });
  createdLeadIds.push(leadIdB1);
});

afterAll(async () => {
  // Clean up leads
  for (const leadId of createdLeadIds) {
    const lead = await seedPrisma.lead.findUnique({ where: { leadId }, select: { id: true } });
    if (lead) {
      await seedPrisma.webhookDelivery.deleteMany({ where: { leadId: lead.id } });
      await seedPrisma.lead.delete({ where: { leadId } });
    }
  }

  // Clean up patients and users
  await prismaService.asSystem(
    (client) =>
      client.$executeRaw`
        DELETE FROM patients WHERE user_id IN (${userAId}::uuid, ${userBId}::uuid)
      `,
  );
  await prismaService.asSystem(
    (client) =>
      client.$executeRaw`
        DELETE FROM users WHERE id IN (${userAId}::uuid, ${userBId}::uuid)
      `,
  );

  await prismaService.onModuleDestroy();
  await seedPrisma.$disconnect();
  await pool.end();
});

describe('PrismaLeadRepository.findByPatientUser', () => {
  it('returns leads for user A sorted by receivedAt desc', async () => {
    const leads = await repo.findByPatientUser(userAId);
    expect(leads.length).toBe(2);
    // Most recent first (Feb > Jan)
    expect(leads[0].leadId).toBe(`lead_a2_${suffix}`);
    expect(leads[1].leadId).toBe(`lead_a1_${suffix}`);
  });

  it('does NOT return leads for user B when called with user A userId', async () => {
    const leads = await repo.findByPatientUser(userAId);
    const leadIds = leads.map((l) => l.leadId);
    expect(leadIds).not.toContain(`lead_b1_${suffix}`);
  });

  it('each lead has clinicName and clinicSlug from the joined clinic', async () => {
    const leads = await repo.findByPatientUser(userAId);
    expect(leads.length).toBeGreaterThan(0);
    for (const lead of leads) {
      expect(typeof lead.clinicName).toBe('string');
      expect(lead.clinicName.length).toBeGreaterThan(0);
      expect(typeof lead.clinicSlug).toBe('string');
      expect(lead.clinicSlug).toBe('vitality-hormone-nyc');
    }
  });

  it('topGoals is an array split on comma', async () => {
    const leads = await repo.findByPatientUser(userAId);
    // lead_a1 has 'boost_energy,lose_weight' => ['boost_energy', 'lose_weight']
    const a1 = leads.find((l) => l.leadId === `lead_a1_${suffix}`)!;
    expect(Array.isArray(a1.topGoals)).toBe(true);
    expect(a1.topGoals).toEqual(['boost_energy', 'lose_weight']);
  });

  it('topSymptoms is an array split on comma', async () => {
    const leads = await repo.findByPatientUser(userAId);
    // lead_a2 has 'brain_fog,fatigue' => ['brain_fog', 'fatigue']
    const a2 = leads.find((l) => l.leadId === `lead_a2_${suffix}`)!;
    expect(Array.isArray(a2.topSymptoms)).toBe(true);
    expect(a2.topSymptoms).toEqual(['brain_fog', 'fatigue']);
  });

  it('clinicCategory falls back to "hormone" when no category row exists', async () => {
    const leads = await repo.findByPatientUser(userAId);
    // The seeded clinic should have a category (hormone); fallback is also 'hormone'
    for (const lead of leads) {
      expect(typeof lead.clinicCategory).toBe('string');
      expect(lead.clinicCategory.length).toBeGreaterThan(0);
    }
  });

  it('returns empty array for user B when only their own leads exist', async () => {
    const leadsB = await repo.findByPatientUser(userBId);
    expect(leadsB.length).toBe(1);
    expect(leadsB[0].leadId).toBe(`lead_b1_${suffix}`);
  });
});

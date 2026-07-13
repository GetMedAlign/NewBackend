/**
 * Integration tests for PrismaLeadRepository against a live Postgres.
 * DATABASE_URL is loaded from test/.env.test.
 *
 * Verifies that `patient_phone` is persisted as ciphertext (never plaintext)
 * and that delivery bookkeeping (webhook_deliveries + delivery_status) works.
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
let encryption: AesGcmEncryptionService;
let repo: PrismaLeadRepository;
let clinicId: string;
const createdLeadIds: string[] = [];

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
  encryption = new AesGcmEncryptionService(config);
  repo = new PrismaLeadRepository(prismaService, encryption);
});

afterAll(async () => {
  for (const leadId of createdLeadIds) {
    const lead = await seedPrisma.lead.findUnique({ where: { leadId }, select: { id: true } });
    if (lead) {
      await seedPrisma.webhookDelivery.deleteMany({ where: { leadId: lead.id } });
      await seedPrisma.lead.delete({ where: { leadId } });
    }
  }
  await prismaService.onModuleDestroy();
  await seedPrisma.$disconnect();
  await pool.end();
});

describe('PrismaLeadRepository', () => {
  it('create() generates a lead_<32 hex> id and stores patient_phone as ciphertext', async () => {
    const phone = '+1-555-867-5309';
    const { leadId } = await repo.create({
      clinicId,
      assessmentId: null,
      patientId: null,
      patientFirstName: 'Testy',
      patientEmail: 'testy@example.com',
      patientZip: '10001',
      treatmentCategory: 'hormone',
      topGoals: 'boost_energy',
      topSymptoms: 'fatigue',
      budgetBand: '200_500',
      telehealthPreference: 'yes',
      appointmentPreference: null,
      startTimeline: null,
      patientPhone: phone,
    });
    createdLeadIds.push(leadId);

    expect(leadId).toMatch(/^lead_[0-9a-f]{32}$/);

    const row = await seedPrisma.lead.findUniqueOrThrow({
      where: { leadId },
      select: {
        patientPhone: true,
        deliveryStatus: true,
        clinicStatus: true,
        leadSource: true,
      },
    });

    expect(row.deliveryStatus).toBe('pending');
    expect(row.clinicStatus).toBe('new');
    expect(row.leadSource).toBe('assessment');

    // Ciphertext, not plaintext.
    expect(row.patientPhone).not.toBeNull();
    expect(row.patientPhone).not.toBe(phone);
    expect(row.patientPhone).not.toContain('555');
    expect(encryption.decrypt(row.patientPhone as string)).toBe(phone);
  });

  it('recordDelivery() and setDeliveryStatus() update the lead bookkeeping', async () => {
    const { leadId } = await repo.create({
      clinicId,
      assessmentId: null,
      patientId: null,
      patientFirstName: 'Deliverer',
      patientEmail: 'deliver@example.com',
      patientZip: null,
      treatmentCategory: 'hormone',
      topGoals: null,
      topSymptoms: null,
      budgetBand: null,
      telehealthPreference: null,
      appointmentPreference: null,
      startTimeline: null,
      patientPhone: null,
    });
    createdLeadIds.push(leadId);

    await repo.recordDelivery(leadId, {
      url: 'https://clinic.example.com/hook',
      status: 'failed',
      responseCode: null,
      error: 'forbidden_address',
    });
    await repo.setDeliveryStatus(leadId, 'failed', new Date());

    const lead = await seedPrisma.lead.findUniqueOrThrow({
      where: { leadId },
      select: { id: true, deliveryStatus: true, deliveredAt: true },
    });
    expect(lead.deliveryStatus).toBe('failed');
    expect(lead.deliveredAt).not.toBeNull();

    const deliveries = await seedPrisma.webhookDelivery.findMany({
      where: { leadId: lead.id },
    });
    expect(deliveries.length).toBe(1);
    expect(deliveries[0].status).toBe('failed');
    expect(deliveries[0].error).toBe('forbidden_address');
  });
});

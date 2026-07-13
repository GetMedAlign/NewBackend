/**
 * Integration test for the patient-journey seed (Task 4).
 *
 * Runs the seed twice (to prove idempotency), then asserts:
 *  - the 8 required test zips exist with plausible numeric lat/long
 *  - there is >= 1 active, billing-current clinic in EACH assessment category
 *  - the overdue clinic exists (so later matchable-filter tests can exclude it)
 *  - a notify_on_lead clinic has business_email + webhook_url + a webhook_secret
 *    that DECRYPTS (round-trip) to a non-empty string
 *
 * Requires a real Postgres instance — DATABASE_URL loaded from test/.env.test.
 */
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { createDecipheriv } from 'crypto';
import { PrismaClient } from '../../generated/prisma/client';
import { seedPatientJourney } from '../../prisma/seed/patient-journey.seed';
import { CLINICS } from '../../prisma/seed/clinics';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** Decrypts using the same nonce(12)||ct||tag(16) base64 scheme as AesGcmEncryptionService. */
function decrypt(ciphertext: string, keyB64: string): string {
  const key = Buffer.from(keyB64, 'base64');
  const buf = Buffer.from(ciphertext, 'base64');
  const nonce = buf.subarray(0, NONCE_BYTES);
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const encrypted = buf.subarray(NONCE_BYTES, buf.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

const REQUIRED_TEST_ZIPS = ['10001', '90001', '60601', '33101', '94102', '98101', '30301', '02108'];

const CATEGORIES = ['hormone', 'peptide', 'med_spa', 'wellness'] as const;

beforeAll(async () => {
  // Run twice to prove the seed is idempotent (no errors, no duplicates).
  await seedPatientJourney(prisma);
  await seedPatientJourney(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});

describe('Patient-journey seed', () => {
  it('seeds the 8 required test zips with plausible numeric lat/long', async () => {
    const zips = await prisma.zipCode.findMany({
      where: { zip: { in: REQUIRED_TEST_ZIPS } },
    });

    expect(zips.map((z) => z.zip).sort()).toEqual([...REQUIRED_TEST_ZIPS].sort());

    for (const z of zips) {
      expect(typeof z.latitude).toBe('number');
      expect(typeof z.longitude).toBe('number');
      // Continental US bounds (roughly).
      expect(z.latitude).toBeGreaterThan(24);
      expect(z.latitude).toBeLessThan(50);
      expect(z.longitude).toBeGreaterThan(-125);
      expect(z.longitude).toBeLessThan(-66);
      expect(z.city.length).toBeGreaterThan(0);
      expect(z.stateCode.length).toBe(2);
    }
  });

  it('is idempotent — a third run does not error or duplicate rows', async () => {
    const beforeZips = await prisma.zipCode.count();
    const beforeClinics = await prisma.clinic.count();
    const beforeCategories = await prisma.clinicCategory.count();
    const beforeServices = await prisma.clinicService.count();

    await seedPatientJourney(prisma);

    expect(await prisma.zipCode.count()).toBe(beforeZips);
    expect(await prisma.clinic.count()).toBe(beforeClinics);
    expect(await prisma.clinicCategory.count()).toBe(beforeCategories);
    expect(await prisma.clinicService.count()).toBe(beforeServices);
  });

  it('has >= 1 active, billing-current clinic in EACH category', async () => {
    for (const category of CATEGORIES) {
      const count = await prisma.clinic.count({
        where: {
          status: 'active',
          billingStatus: 'current',
          categories: { some: { category } },
        },
      });
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });

  it('includes an overdue clinic (for later filter-exclusion tests)', async () => {
    const overdue = await prisma.clinic.count({ where: { billingStatus: 'overdue' } });
    expect(overdue).toBeGreaterThanOrEqual(1);
  });

  it('includes a non-active clinic (for later filter-exclusion tests)', async () => {
    const nonActive = await prisma.clinic.count({ where: { status: { not: 'active' } } });
    expect(nonActive).toBeGreaterThanOrEqual(1);
  });

  it('has a notify_on_lead clinic with email, webhook, and a decryptable secret', async () => {
    const keyB64 = process.env['ENCRYPTION_KEY'];
    expect(keyB64).toBeDefined();

    const clinics = await prisma.clinic.findMany({ where: { notifyOnLead: true } });
    expect(clinics.length).toBeGreaterThanOrEqual(2);

    // At least one such clinic must be fully configured for lead delivery.
    const configured = clinics.filter((c) => c.businessEmail && c.webhookUrl && c.webhookSecret);
    expect(configured.length).toBeGreaterThanOrEqual(2);

    for (const clinic of configured) {
      expect(clinic.businessEmail).toMatch(/@/);
      expect(clinic.webhookUrl).toMatch(/^https:\/\//);
      const decrypted = decrypt(clinic.webhookSecret as string, keyB64 as string);
      // Prove true round-trip: look up the known plaintext from the seed data.
      const seedClinic = CLINICS.find((s) => s.slug === clinic.slug);
      expect(seedClinic?.webhookSecretPlaintext).not.toBeNull();
      expect(decrypted).toBe(seedClinic?.webhookSecretPlaintext);
    }

    // Explicit spot-check on vitality-hormone-nyc (the primary notify+webhook clinic).
    const vitality = await prisma.clinic.findUniqueOrThrow({
      where: { slug: 'vitality-hormone-nyc' },
    });
    expect(vitality.webhookSecret).not.toBeNull();
    expect(decrypt(vitality.webhookSecret as string, keyB64 as string)).toBe(
      'whsec_vitality_hormone_nyc_5f3a9c',
    );
  });

  it('has clinics spanning all category, budget, telehealth, and financing variety', async () => {
    const telehealthOnly = await prisma.clinic.count({
      where: { telehealthAvailable: true, city: null },
    });
    expect(telehealthOnly).toBeGreaterThanOrEqual(1);

    const inPersonOnly = await prisma.clinic.count({
      where: { telehealthAvailable: false },
    });
    expect(inPersonOnly).toBeGreaterThanOrEqual(1);

    const financing = await prisma.clinic.count({ where: { financingAvailable: true } });
    expect(financing).toBeGreaterThanOrEqual(1);

    const insurance = await prisma.clinic.count({ where: { acceptsInsurance: true } });
    expect(insurance).toBeGreaterThanOrEqual(1);
  });
});

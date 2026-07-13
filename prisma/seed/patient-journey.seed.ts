/**
 * Idempotent patient-journey seed entry point (Task 4).
 *
 * Seeds ZIP codes, then clinics (with their categories + services). Uses upserts
 * throughout so running it multiple times neither errors nor duplicates rows.
 *
 * A standalone seed connects as the `postgres` superuser via DATABASE_URL, which
 * bypasses RLS — the correct behaviour for seeding public read-model data.
 *
 * The clinic `webhook_secret` column is ENCRYPTED. We encrypt here with the exact
 * same AES-256-GCM scheme (nonce(12)||ciphertext||tag(16), base64) that
 * AesGcmEncryptionService uses, so the leads slice can decrypt round-trip.
 */
import { createCipheriv, randomBytes } from 'crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { ZIP_CODES } from './zip-codes';
import { CLINICS } from './clinics';

const NONCE_BYTES = 12;

/**
 * Encrypts plaintext with AES-256-GCM using the nonce(12)||ciphertext||tag(16)
 * base64 layout — identical to AesGcmEncryptionService so decrypt round-trips.
 */
function encryptWebhookSecret(plaintext: string, keyB64: string): string {
  const key = Buffer.from(keyB64, 'base64');
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, encrypted, tag]).toString('base64');
}

export async function seedPatientJourney(prisma: PrismaClient): Promise<void> {
  const encryptionKey = process.env['ENCRYPTION_KEY'];
  if (!encryptionKey) {
    throw new Error('ENCRYPTION_KEY must be set to seed encrypted clinic webhook secrets');
  }

  // --- ZIP codes ----------------------------------------------------------
  for (const z of ZIP_CODES) {
    await prisma.zipCode.upsert({
      where: { zip: z.zip },
      update: {
        latitude: z.latitude,
        longitude: z.longitude,
        city: z.city,
        stateCode: z.stateCode,
      },
      create: {
        zip: z.zip,
        latitude: z.latitude,
        longitude: z.longitude,
        city: z.city,
        stateCode: z.stateCode,
      },
    });
  }

  // --- Clinics (+ categories + services) ----------------------------------
  for (const c of CLINICS) {
    const webhookSecret =
      c.webhookSecretPlaintext !== null
        ? encryptWebhookSecret(c.webhookSecretPlaintext, encryptionKey)
        : null;

    const clinicData = {
      name: c.name,
      about: c.about,
      providerName: c.providerName,
      websiteUrl: c.websiteUrl,
      rating: c.rating,
      reviewCount: c.reviewCount,
      latitude: c.latitude,
      longitude: c.longitude,
      city: c.city,
      stateCode: c.stateCode,
      telehealthAvailable: c.telehealthAvailable,
      newPatientWait: c.newPatientWait,
      consultationFeeBand: c.consultationFeeBand,
      monthlyProgramBand: c.monthlyProgramBand,
      financingAvailable: c.financingAvailable,
      acceptsInsurance: c.acceptsInsurance,
      status: c.status,
      billingStatus: c.billingStatus,
      businessEmail: c.businessEmail,
      webhookUrl: c.webhookUrl,
      webhookSecret,
      notifyOnLead: c.notifyOnLead,
    };

    const clinic = await prisma.clinic.upsert({
      where: { slug: c.slug },
      update: clinicData,
      create: { slug: c.slug, ...clinicData },
    });

    // Categories — delete-then-recreate keeps the join tables idempotent
    // (composite PKs, no natural "update" surface).
    await prisma.clinicCategory.deleteMany({ where: { clinicId: clinic.id } });
    await prisma.clinicCategory.createMany({
      data: c.categories.map((category) => ({ clinicId: clinic.id, category })),
    });

    await prisma.clinicService.deleteMany({ where: { clinicId: clinic.id } });
    await prisma.clinicService.createMany({
      data: c.serviceCodes.map((serviceCode) => ({ clinicId: clinic.id, serviceCode })),
    });
  }
}

/** CLI entry point: `pnpm seed:pj`. */
async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  try {
    await seedPatientJourney(prisma);
    // eslint-disable-next-line no-console
    console.log('Patient-journey seed complete.');
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

// Only run main() when executed directly (not when imported by tests).
if (require.main === module) {
  main().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}

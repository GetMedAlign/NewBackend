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
 *
 * Clinic-portal additions (Task 3):
 *   - New clinic columns (differentiators, offersLabWork, etc.) are populated
 *     via the existing upsert.
 *   - Two clinic-role users are seeded (one per notify-enabled clinic) so e2e
 *     tests can log in as a clinic without additional setup.
 *
 * Seeded clinic user credentials:
 *   Email: clinic-vitality@medalign-seed.example.com  Password: SeedClinic1!
 *   Email: clinic-apex@medalign-seed.example.com      Password: SeedClinic1!
 *   (Both use the same shared password for test convenience.)
 */
import { createCipheriv, randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { ZIP_CODES } from './zip-codes';
import { CLINICS } from './clinics';

const NONCE_BYTES = 12;

/**
 * Fixed credentials for seeded clinic users.
 * Import this constant in e2e tests to log in as a clinic.
 *
 * Credentials:
 *   clinic-vitality@medalign-seed.example.com  /  SeedClinic1!  (vitality-hormone-nyc)
 *   clinic-apex@medalign-seed.example.com      /  SeedClinic1!  (apex-peptide-telehealth)
 */
export const SEEDED_CLINIC_USERS: ReadonlyArray<{
  email: string;
  password: string;
  clinicSlug: string;
}> = [
  {
    email: 'clinic-vitality@medalign-seed.example.com',
    password: 'SeedClinic1!',
    clinicSlug: 'vitality-hormone-nyc',
  },
  {
    email: 'clinic-apex@medalign-seed.example.com',
    password: 'SeedClinic1!',
    clinicSlug: 'apex-peptide-telehealth',
  },
];

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
      // Clinic-portal columns (Task 3)
      differentiators: c.differentiators,
      offersLabWork: c.offersLabWork,
      insuranceNotes: c.insuranceNotes,
      credentials: c.credentials,
      npiNumber: c.npiNumber,
      stateLicenseNumber: c.stateLicenseNumber,
      logoUrl: c.logoUrl,
      photoCount: c.photoCount,
      weeklySummary: c.weeklySummary,
      location: c.location,
      webhookHealth: c.webhookHealth,
      suspensionReason: c.suspensionReason,
    };

    const clinic = await prisma.clinic.upsert({
      where: { slug: c.slug },
      update: clinicData,
      create: { slug: c.slug, ...clinicData },
    });

    // Categories — delete-then-recreate keeps the join tables idempotent
    // (composite PKs, no natural "update" surface). Wrapped in transactions so
    // a crash cannot leave a clinic with zero categories or services.
    await prisma.$transaction([
      prisma.clinicCategory.deleteMany({ where: { clinicId: clinic.id } }),
      prisma.clinicCategory.createMany({
        data: c.categories.map((category) => ({ clinicId: clinic.id, category })),
      }),
    ]);

    await prisma.$transaction([
      prisma.clinicService.deleteMany({ where: { clinicId: clinic.id } }),
      prisma.clinicService.createMany({
        data: c.serviceCodes.map((serviceCode) => ({ clinicId: clinic.id, serviceCode })),
      }),
    ]);
  }

  // --- Clinic users --------------------------------------------------------
  // Seed clinic-role users for the two notify-enabled clinics so e2e tests
  // can log in as a clinic. Idempotent: skips creation if the email already
  // exists, then ensures role=clinic and clinic_id are set regardless.
  for (const seedUser of SEEDED_CLINIC_USERS) {
    const clinic = await prisma.clinic.findUniqueOrThrow({
      where: { slug: seedUser.clinicSlug },
      select: { id: true },
    });

    // Check if the user already exists to avoid calling create_user twice.
    const existing = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM users WHERE email = ${seedUser.email}::citext
    `;

    let userId: string;
    if (existing.length === 0) {
      // Hash the password using argon2id (matches Foundation Argon2PasswordHasher).
      const passwordHash = await argon2.hash(seedUser.password, { type: argon2.argon2id });

      // create_user inserts the user row + a default 'patient' user_roles row.
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT create_user(${seedUser.email}::citext, ${passwordHash}) AS id
      `;
      userId = rows[0]!.id;
    } else {
      userId = existing[0]!.id;
    }

    // Ensure the user has exactly the 'clinic' role.
    // Insert-then-delete: avoids a unique-violation an UPDATE would cause when a
    // clinic row already exists, and is fully idempotent across any number of runs.
    await prisma.$executeRaw`
      INSERT INTO user_roles (user_id, role)
      VALUES (${userId}::uuid, 'clinic')
      ON CONFLICT (user_id, role) DO NOTHING
    `;
    await prisma.$executeRaw`
      DELETE FROM user_roles WHERE user_id = ${userId}::uuid AND role = 'patient'
    `;

    // Ensure clinic_id is set on the user row.
    await prisma.$executeRaw`
      UPDATE users SET clinic_id = ${clinic.id}::uuid WHERE id = ${userId}::uuid
    `;
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

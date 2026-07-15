/**
 * Integration tests for PrismaClinicWebhookRepository against a live Postgres.
 * DATABASE_URL is loaded from test/.env.test via jest.int.config.ts setupFiles.
 *
 * Verifies:
 *  - listWebhookDeliveries returns deliveries scoped to the caller clinic (RLS)
 *  - rotateWebhookSecret stores ciphertext on the clinics row
 *  - getWebhookSecretCiphertext returns what was stored
 *  - round-trip: encrypt -> store -> retrieve -> decrypt
 */
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PrismaClinicWebhookRepository } from '../../src/modules/clinic-portal/infrastructure/prisma-clinic-webhook.repository';
import { AesGcmEncryptionService } from '../../src/infrastructure/crypto/aes-gcm-encryption.service';
import type { Env } from '../../src/infrastructure/config/env.schema';
import { ConfigService } from '@nestjs/config';
import { seedPatientJourney } from '../../prisma/seed/patient-journey.seed';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const adapter = new PrismaPg(pool);
const seedPrisma = new PrismaClient({ adapter });

let prismaService: PrismaService;
let repo: PrismaClinicWebhookRepository;
let clinicAId: string;
let clinicBId: string;
let leadAUuid: string;
let leadBUuid: string;
let deliveryAId: string;
let deliveryBId: string;

const LEAD_A_BUSINESS_ID = 'wh-int-spec-lead-clinic-a-00000000000001';
const LEAD_B_BUSINESS_ID = 'wh-int-spec-lead-clinic-b-00000000000001';

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
  repo = new PrismaClinicWebhookRepository(prismaService);

  // Insert a lead for clinic A
  const rowsA = await prismaService.asSystem(
    (client) => client.$queryRaw<{ id: string }[]>`
      INSERT INTO leads (
        lead_id, clinic_id, patient_first_name, patient_email,
        treatment_category, lead_source, delivery_status, clinic_status, received_at
      )
      VALUES (
        ${LEAD_A_BUSINESS_ID},
        ${clinicAId}::uuid,
        'Alice', 'alice@wh-int-spec.example.com',
        'hormone', 'assessment', 'delivered', 'new', NOW()
      )
      ON CONFLICT (lead_id) DO UPDATE SET clinic_id = EXCLUDED.clinic_id
      RETURNING id
    `,
  );
  leadAUuid = rowsA[0]!.id;

  // Insert a delivery for clinic A's lead
  const delRowsA = await prismaService.asSystem(
    (client) => client.$queryRaw<{ id: string }[]>`
      INSERT INTO webhook_deliveries (lead_id, url, status, response_code, error, attempted_at)
      VALUES (${leadAUuid}::uuid, 'https://example.com/hook', 'success', 200, NULL, NOW())
      RETURNING id
    `,
  );
  deliveryAId = delRowsA[0]!.id;

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
        'Bob', 'bob@wh-int-spec.example.com',
        'hormone', 'assessment', 'pending', 'new', NOW()
      )
      ON CONFLICT (lead_id) DO UPDATE SET clinic_id = EXCLUDED.clinic_id
      RETURNING id
    `,
  );
  leadBUuid = rowsB[0]!.id;

  // Insert a delivery for clinic B's lead
  const delRowsB = await prismaService.asSystem(
    (client) => client.$queryRaw<{ id: string }[]>`
      INSERT INTO webhook_deliveries (lead_id, url, status, response_code, error, attempted_at)
      VALUES (${leadBUuid}::uuid, 'https://clinic-b.example.com/hook', 'failed', 500, 'timeout', NOW())
      RETURNING id
    `,
  );
  deliveryBId = delRowsB[0]!.id;
});

afterAll(async () => {
  // Clean up deliveries first (FK constraint)
  await prismaService.asSystem(
    (client) =>
      client.$executeRaw`DELETE FROM webhook_deliveries WHERE id IN (${deliveryAId}::uuid, ${deliveryBId}::uuid)`,
  );
  await prismaService.asSystem(
    (client) =>
      client.$executeRaw`DELETE FROM leads WHERE id IN (${leadAUuid}::uuid, ${leadBUuid}::uuid)`,
  );
  // Reset webhook_secret on clinic A to avoid contaminating other tests
  await prismaService.asSystem(
    (client) =>
      client.$executeRaw`UPDATE clinics SET webhook_secret = NULL WHERE id = ${clinicAId}::uuid`,
  );
  await seedPatientJourney(seedPrisma);
  await prismaService.onModuleDestroy();
  await seedPrisma.$disconnect();
  await pool.end();
});

describe('PrismaClinicWebhookRepository.listWebhookDeliveries', () => {
  it('returns the delivery for clinic A and not clinic B (RLS isolation)', async () => {
    const deliveries = await repo.listWebhookDeliveries(clinicAId);

    expect(Array.isArray(deliveries)).toBe(true);

    const deliveryA = deliveries.find((d) => d.lead_id === LEAD_A_BUSINESS_ID);
    expect(deliveryA).toBeDefined();
    expect(deliveryA!.status).toBe('success');
    expect(deliveryA!.http_status_code).toBe(200);
    expect(deliveryA!.error_message).toBeNull();
    expect(typeof deliveryA!.attempted_at).toBe('string');
    // Must parse as valid date
    expect(() => new Date(deliveryA!.attempted_at)).not.toThrow();

    // Clinic B's delivery must not appear
    const deliveryB = deliveries.find((d) => d.lead_id === LEAD_B_BUSINESS_ID);
    expect(deliveryB).toBeUndefined();
  });

  it('returns clinic B delivery only in clinic B context', async () => {
    const deliveries = await repo.listWebhookDeliveries(clinicBId);

    const deliveryB = deliveries.find((d) => d.lead_id === LEAD_B_BUSINESS_ID);
    expect(deliveryB).toBeDefined();

    const deliveryA = deliveries.find((d) => d.lead_id === LEAD_A_BUSINESS_ID);
    expect(deliveryA).toBeUndefined();
  });
});

describe('PrismaClinicWebhookRepository.rotateWebhookSecret / getWebhookSecretCiphertext', () => {
  it('stores the ciphertext and retrieves it unchanged', async () => {
    const fakeCiphertext = 'fake-ciphertext-abc123';

    await repo.rotateWebhookSecret(clinicAId, fakeCiphertext);
    const retrieved = await repo.getWebhookSecretCiphertext(clinicAId);

    expect(retrieved).toBe(fakeCiphertext);
  });

  it('returns null for a clinic with no stored secret', async () => {
    // Reset clinic A's secret first
    await prismaService.asSystem(
      (client) =>
        client.$executeRaw`UPDATE clinics SET webhook_secret = NULL WHERE id = ${clinicAId}::uuid`,
    );

    const result = await repo.getWebhookSecretCiphertext(clinicAId);
    expect(result).toBeNull();
  });

  it('full round-trip: encrypt -> store -> retrieve -> decrypt', async () => {
    // Build a real AesGcmEncryptionService using the test env ENCRYPTION_KEY
    const encryptionKey = process.env['ENCRYPTION_KEY'];
    if (!encryptionKey) {
      // Skip if not configured in the test environment
      return;
    }

    const configService = {
      getOrThrow: (key: string) => {
        if (key === 'ENCRYPTION_KEY') return encryptionKey;
        throw new Error(`Unknown config key: ${key}`);
      },
    } as unknown as ConfigService<Env, true>;

    const encryption = new AesGcmEncryptionService(configService);
    const plaintext = 'a'.repeat(64); // 64-char hex-like string

    const ciphertext = encryption.encrypt(plaintext);
    await repo.rotateWebhookSecret(clinicAId, ciphertext);

    const retrievedCiphertext = await repo.getWebhookSecretCiphertext(clinicAId);
    expect(retrievedCiphertext).not.toBeNull();
    expect(retrievedCiphertext).toBe(ciphertext);

    const decrypted = encryption.decrypt(retrievedCiphertext!);
    expect(decrypted).toBe(plaintext);
  });
});

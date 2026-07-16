/**
 * Integration test for the demo-seed additions.
 *
 * Verifies:
 *  - 2 seeded patient users exist with a `patients` row each.
 *  - At least 1 assessment exists linked to a seeded patient, with PHI columns
 *    stored as ciphertext (not plaintext) and decrypting round-trip correctly.
 *  - At least 3 leads exist across at least 2 clinics with varied clinic_status
 *    values and patient_phone stored as ciphertext.
 *  - At least 1 webhook_delivery exists for a notify-enabled clinic's lead.
 *  - The photo'd clinic (glow-med-spa-miami) has 2 clinic_photos and matching
 *    photo_count.
 *  - Re-running the seed a SECOND time does not error or duplicate any rows
 *    (idempotency).
 *
 * Requires a real Postgres instance — DATABASE_URL loaded from test/.env.test.
 */
import { createDecipheriv } from 'crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import {
  seedPatientJourney,
  SEEDED_PATIENT_USERS,
  SEEDED_PATIENT_SESSION_ID,
  SEEDED_LEAD_IDS,
  SEEDED_PHOTO_CLINIC_SLUG,
} from '../../prisma/seed/patient-journey.seed';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** Decrypts using the nonce(12)||ct||tag(16) base64 scheme. */
function decrypt(ciphertext: string, keyB64: string): string {
  const key = Buffer.from(keyB64, 'base64');
  const buf = Buffer.from(ciphertext, 'base64');
  const nonce = buf.subarray(0, NONCE_BYTES);
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const ct = buf.subarray(NONCE_BYTES, buf.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** Returns true if the string looks like base64 AES-GCM ciphertext (not plain text). */
function looksLikeCiphertext(value: string): boolean {
  // At minimum: 12 nonce + 1 byte ct + 16 tag = 29 bytes → ceil(29*4/3)=40 chars
  if (value.length < 40) return false;
  // Must be valid base64
  const isBase64 = /^[A-Za-z0-9+/]+=*$/.test(value);
  return isBase64;
}

beforeAll(async () => {
  // Run twice to prove idempotency.
  await seedPatientJourney(prisma);
  await seedPatientJourney(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
  await pool.end();
});

describe('Demo seed — patient users', () => {
  it('exports SEEDED_PATIENT_USERS with 2 entries', () => {
    expect(SEEDED_PATIENT_USERS.length).toBe(2);
    for (const u of SEEDED_PATIENT_USERS) {
      expect(u.email).toMatch(/@/);
      expect(u.password.length).toBeGreaterThan(0);
    }
  });

  it('each patient user exists in the DB with a patients row', async () => {
    for (const u of SEEDED_PATIENT_USERS) {
      const userRows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM users WHERE email = ${u.email}::citext
      `;
      expect(userRows.length).toBe(1);
      const userId = userRows[0]!.id;

      const patientRows = await prisma.$queryRaw<{ id: string; user_id: string }[]>`
        SELECT id, user_id FROM patients WHERE user_id = ${userId}::uuid
      `;
      expect(patientRows.length).toBe(1);
      expect(patientRows[0]!.user_id).toBe(userId);
    }
  });

  it('patient users have the patient role (not clinic)', async () => {
    for (const u of SEEDED_PATIENT_USERS) {
      const roleRows = await prisma.$queryRaw<{ role: string }[]>`
        SELECT ur.role FROM user_roles ur
        JOIN users u ON u.id = ur.user_id
        WHERE u.email = ${u.email}::citext
        ORDER BY ur.role
      `;
      expect(roleRows.map((r) => r.role)).toEqual(['patient']);
    }
  });

  it('re-running the seed does not duplicate patient users or patients rows', async () => {
    const emails = SEEDED_PATIENT_USERS.map((u) => u.email);
    const beforeUsers = await prisma.$queryRaw<{ count: string }[]>`
      SELECT count(*)::text AS count FROM users
      WHERE email = ANY(${emails}::citext[])
    `;
    const beforePatients = await prisma.$queryRaw<{ count: string }[]>`
      SELECT count(*)::text AS count FROM patients p
      JOIN users u ON u.id = p.user_id
      WHERE u.email = ANY(${emails}::citext[])
    `;

    // Third run
    await seedPatientJourney(prisma);

    const afterUsers = await prisma.$queryRaw<{ count: string }[]>`
      SELECT count(*)::text AS count FROM users
      WHERE email = ANY(${emails}::citext[])
    `;
    const afterPatients = await prisma.$queryRaw<{ count: string }[]>`
      SELECT count(*)::text AS count FROM patients p
      JOIN users u ON u.id = p.user_id
      WHERE u.email = ANY(${emails}::citext[])
    `;

    expect(Number(afterUsers[0]!.count)).toBe(Number(beforeUsers[0]!.count));
    expect(Number(afterPatients[0]!.count)).toBe(Number(beforePatients[0]!.count));
  });
});

describe('Demo seed — assessments', () => {
  it('exports SEEDED_PATIENT_SESSION_ID as a fixed string', () => {
    expect(typeof SEEDED_PATIENT_SESSION_ID).toBe('string');
    expect(SEEDED_PATIENT_SESSION_ID.length).toBeGreaterThan(0);
  });

  it('the seeded assessment exists and is linked to a patient', async () => {
    const rows = await prisma.$queryRaw<
      { id: string; patient_id: string | null; treatment_category: string }[]
    >`
      SELECT id, patient_id, treatment_category
      FROM patient_assessments
      WHERE session_id = ${SEEDED_PATIENT_SESSION_ID}
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]!.patient_id).not.toBeNull();
    expect(rows[0]!.treatment_category).toBe('hormone');
  });

  it('PHI columns are stored as ciphertext, not plaintext', async () => {
    const keyB64 = process.env['ENCRYPTION_KEY'];
    expect(keyB64).toBeDefined();

    const rows = await prisma.$queryRaw<
      {
        biological_sex: string | null;
        symptom_duration: string | null;
        appointment_preference: string | null;
        exercise_frequency: string | null;
      }[]
    >`
      SELECT biological_sex, symptom_duration, appointment_preference, exercise_frequency
      FROM patient_assessments
      WHERE session_id = ${SEEDED_PATIENT_SESSION_ID}
    `;
    expect(rows.length).toBe(1);
    const row = rows[0]!;

    // Each non-null PHI field must look like ciphertext and must NOT equal the plaintext value.
    if (row.biological_sex !== null) {
      expect(looksLikeCiphertext(row.biological_sex)).toBe(true);
      expect(row.biological_sex).not.toBe('male');
      expect(row.biological_sex).not.toBe('female');
      // Decrypt must produce a sensible value.
      const plain = decrypt(row.biological_sex, keyB64 as string);
      expect(plain.length).toBeGreaterThan(0);
    }
    if (row.symptom_duration !== null) {
      expect(looksLikeCiphertext(row.symptom_duration)).toBe(true);
      const plain = decrypt(row.symptom_duration, keyB64 as string);
      expect(plain.length).toBeGreaterThan(0);
    }
    if (row.appointment_preference !== null) {
      expect(looksLikeCiphertext(row.appointment_preference)).toBe(true);
      const plain = decrypt(row.appointment_preference, keyB64 as string);
      expect(plain.length).toBeGreaterThan(0);
    }
  });

  it('re-running the seed does not duplicate the assessment', async () => {
    const before = await prisma.$queryRaw<{ count: string }[]>`
      SELECT count(*)::text AS count FROM patient_assessments
      WHERE session_id = ${SEEDED_PATIENT_SESSION_ID}
    `;

    await seedPatientJourney(prisma);

    const after = await prisma.$queryRaw<{ count: string }[]>`
      SELECT count(*)::text AS count FROM patient_assessments
      WHERE session_id = ${SEEDED_PATIENT_SESSION_ID}
    `;

    expect(Number(after[0]!.count)).toBe(Number(before[0]!.count));
    expect(Number(after[0]!.count)).toBe(1);
  });
});

describe('Demo seed — leads', () => {
  it('exports SEEDED_LEAD_IDS with at least 3 entries', () => {
    expect(SEEDED_LEAD_IDS.length).toBeGreaterThanOrEqual(3);
  });

  it('all seeded leads exist in the DB', async () => {
    for (const leadId of SEEDED_LEAD_IDS) {
      const rows = await prisma.$queryRaw<{ lead_id: string }[]>`
        SELECT lead_id FROM leads WHERE lead_id = ${leadId}
      `;
      expect(rows.length).toBe(1);
    }
  });

  it('seeded leads span at least 2 different clinics', async () => {
    const rows = await prisma.$queryRaw<{ clinic_id: string }[]>`
      SELECT DISTINCT clinic_id FROM leads WHERE lead_id = ANY(${SEEDED_LEAD_IDS}::text[])
    `;
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('seeded leads have varied clinic_status values (new, contacted, booked)', async () => {
    const rows = await prisma.$queryRaw<{ clinic_status: string }[]>`
      SELECT DISTINCT clinic_status FROM leads WHERE lead_id = ANY(${SEEDED_LEAD_IDS}::text[])
    `;
    const statuses = rows.map((r) => r.clinic_status);
    expect(statuses.length).toBeGreaterThanOrEqual(2);
    // At minimum must have 'new' and at least one other status
    expect(statuses).toContain('new');
  });

  it('patient_phone is stored as ciphertext, not plaintext', async () => {
    const keyB64 = process.env['ENCRYPTION_KEY'];
    expect(keyB64).toBeDefined();

    const rows = await prisma.$queryRaw<{ patient_phone: string | null }[]>`
      SELECT patient_phone FROM leads
      WHERE lead_id = ANY(${SEEDED_LEAD_IDS}::text[])
        AND patient_phone IS NOT NULL
    `;
    expect(rows.length).toBeGreaterThanOrEqual(1);

    for (const row of rows) {
      if (row.patient_phone !== null) {
        expect(looksLikeCiphertext(row.patient_phone)).toBe(true);
        expect(row.patient_phone).not.toMatch(/^\+?[0-9\s\-().]+$/); // not a plain phone number
        const plain = decrypt(row.patient_phone, keyB64 as string);
        expect(plain.length).toBeGreaterThan(0);
      }
    }
  });

  it('re-running the seed does not duplicate leads', async () => {
    const before = await prisma.$queryRaw<{ count: string }[]>`
      SELECT count(*)::text AS count FROM leads WHERE lead_id = ANY(${SEEDED_LEAD_IDS}::text[])
    `;

    await seedPatientJourney(prisma);

    const after = await prisma.$queryRaw<{ count: string }[]>`
      SELECT count(*)::text AS count FROM leads WHERE lead_id = ANY(${SEEDED_LEAD_IDS}::text[])
    `;

    expect(Number(after[0]!.count)).toBe(Number(before[0]!.count));
    expect(Number(after[0]!.count)).toBe(SEEDED_LEAD_IDS.length);
  });
});

describe('Demo seed — webhook deliveries', () => {
  it('at least 1 webhook delivery exists for a notify-enabled clinic lead', async () => {
    const rows = await prisma.$queryRaw<{ id: string; status: string; response_code: number }[]>`
      SELECT wd.id, wd.status, wd.response_code
      FROM webhook_deliveries wd
      JOIN leads l ON l.id = wd.lead_id
      JOIN clinics c ON c.id = l.clinic_id
      WHERE c.notify_on_lead = true
        AND l.lead_id = ANY(${SEEDED_LEAD_IDS}::text[])
    `;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const successRow = rows.find((r) => r.status === 'success');
    expect(successRow).toBeDefined();
    expect(successRow!.response_code).toBe(200);
  });

  it('re-running the seed does not stack webhook delivery duplicates', async () => {
    // Count deliveries for the seeded leads before a re-run
    const before = await prisma.$queryRaw<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM webhook_deliveries wd
      JOIN leads l ON l.id = wd.lead_id
      WHERE l.lead_id = ANY(${SEEDED_LEAD_IDS}::text[])
    `;

    await seedPatientJourney(prisma);

    const after = await prisma.$queryRaw<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM webhook_deliveries wd
      JOIN leads l ON l.id = wd.lead_id
      WHERE l.lead_id = ANY(${SEEDED_LEAD_IDS}::text[])
    `;

    expect(Number(after[0]!.count)).toBe(Number(before[0]!.count));
  });
});

describe('Demo seed — clinic photos', () => {
  it('exports SEEDED_PHOTO_CLINIC_SLUG', () => {
    expect(typeof SEEDED_PHOTO_CLINIC_SLUG).toBe('string');
    expect(SEEDED_PHOTO_CLINIC_SLUG.length).toBeGreaterThan(0);
  });

  it('the photo clinic has exactly 2 clinic_photos', async () => {
    const rows = await prisma.$queryRaw<{ id: string; display_order: number }[]>`
      SELECT cp.id, cp.display_order
      FROM clinic_photos cp
      JOIN clinics c ON c.id = cp.clinic_id
      WHERE c.slug = ${SEEDED_PHOTO_CLINIC_SLUG}
      ORDER BY cp.display_order
    `;
    expect(rows.length).toBe(2);
    expect(rows[0]!.display_order).toBe(0);
    expect(rows[1]!.display_order).toBe(1);
  });

  it('the photo clinic has photo_count = 2', async () => {
    const rows = await prisma.$queryRaw<{ photo_count: number }[]>`
      SELECT photo_count FROM clinics WHERE slug = ${SEEDED_PHOTO_CLINIC_SLUG}
    `;
    expect(rows.length).toBe(1);
    expect(Number(rows[0]!.photo_count)).toBe(2);
  });

  it('re-running the seed does not duplicate clinic photos', async () => {
    const before = await prisma.$queryRaw<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM clinic_photos cp
      JOIN clinics c ON c.id = cp.clinic_id
      WHERE c.slug = ${SEEDED_PHOTO_CLINIC_SLUG}
    `;

    await seedPatientJourney(prisma);

    const after = await prisma.$queryRaw<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM clinic_photos cp
      JOIN clinics c ON c.id = cp.clinic_id
      WHERE c.slug = ${SEEDED_PHOTO_CLINIC_SLUG}
    `;

    expect(Number(after[0]!.count)).toBe(Number(before[0]!.count));
    expect(Number(after[0]!.count)).toBe(2);
  });
});

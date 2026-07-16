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
 * Demo-data additions:
 *   - Two patient users (patient-alex, patient-sam) with a `patients` row each.
 *   - One assessment (fixed session_id) with all PHI columns AES-GCM encrypted.
 *   - Four leads spread across 2+ clinics with varied clinic_status / delivery_status.
 *   - One webhook_delivery for the vitality-hormone-nyc lead.
 *   - Two clinic_photos for glow-med-spa-miami.
 *
 * Clinic-applications additions (Task 3):
 *   - A superadmin user is seeded so admin endpoints can be tested/used.
 *   - Two sample pending clinic_applications are seeded (each with categories
 *     and services) so the review workflow has data to operate on.
 *
 * Seeded clinic user credentials:
 *   Email: clinic-vitality@medalign-seed.example.com  Password: SeedClinic1!
 *   Email: clinic-apex@medalign-seed.example.com      Password: SeedClinic1!
 *
 * Seeded patient user credentials:
 *   Email: patient-alex@medalign-seed.example.com  Password: SeedPatient1!
 *   Email: patient-sam@medalign-seed.example.com   Password: SeedPatient1!
 *
 * Seeded superadmin credentials:
 *   Email: superadmin@medalign-seed.example.com  Password: SeedAdmin1!
 */
import { createCipheriv, randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../../generated/prisma/client';
import { ZIP_CODES } from './zip-codes';
import { CLINICS } from './clinics';

const NONCE_BYTES = 12;

/**
 * Fixed credentials for the seeded superadmin user.
 * Import this constant in e2e/integration tests to authenticate as a superadmin.
 *
 * Credentials:
 *   superadmin@medalign-seed.example.com  /  SeedAdmin1!
 */
export const SEEDED_ADMIN_USER: Readonly<{ email: string; password: string }> = {
  email: 'superadmin@medalign-seed.example.com',
  password: 'SeedAdmin1!',
};

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
 * Fixed credentials for seeded patient users.
 * Import this constant in e2e / integration tests to log in as a patient.
 *
 * Credentials:
 *   patient-alex@medalign-seed.example.com  /  SeedPatient1!
 *   patient-sam@medalign-seed.example.com   /  SeedPatient1!
 */
export const SEEDED_PATIENT_USERS: ReadonlyArray<{
  email: string;
  password: string;
}> = [
  { email: 'patient-alex@medalign-seed.example.com', password: 'SeedPatient1!' },
  { email: 'patient-sam@medalign-seed.example.com', password: 'SeedPatient1!' },
];

/**
 * Fixed session_id for the seeded patient assessment.
 * Idempotency guard: the seed skips creation if this session_id already exists.
 */
export const SEEDED_PATIENT_SESSION_ID = 'session_seed0000000000000000000000000001';

/**
 * Fixed lead_id values for the 4 seeded demo leads.
 * Idempotency guard: the seed skips creation if the lead_id already exists.
 */
export const SEEDED_LEAD_IDS: ReadonlyArray<string> = [
  'lead_seed00000000000000000000000000000001',
  'lead_seed00000000000000000000000000000002',
  'lead_seed00000000000000000000000000000003',
  'lead_seed00000000000000000000000000000004',
];

/**
 * Slug of the clinic that receives seeded clinic_photos.
 */
export const SEEDED_PHOTO_CLINIC_SLUG = 'glow-med-spa-miami';

/**
 * Encrypts plaintext with AES-256-GCM using the nonce(12)||ciphertext||tag(16)
 * base64 layout — identical to AesGcmEncryptionService so decrypt round-trips.
 * Used for both webhook secrets and PHI fields (same scheme throughout).
 */
function encryptField(plaintext: string, keyB64: string): string {
  const key = Buffer.from(keyB64, 'base64');
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, encrypted, tag]).toString('base64');
}

/** Kept for back-compat; delegates to encryptField. */
function encryptWebhookSecret(plaintext: string, keyB64: string): string {
  return encryptField(plaintext, keyB64);
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

  // --- Patient users + patients rows ---------------------------------------
  // Create two patient-role users for demo purposes. Unlike clinic users they
  // keep the default `patient` role that create_user assigns — no role swap.
  // A `patients` row is inserted separately because create_user does not create one.
  const patientUserIds: string[] = [];
  for (const seedUser of SEEDED_PATIENT_USERS) {
    const existing = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM users WHERE email = ${seedUser.email}::citext
    `;

    let userId: string;
    if (existing.length === 0) {
      const passwordHash = await argon2.hash(seedUser.password, { type: argon2.argon2id });
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT create_user(${seedUser.email}::citext, ${passwordHash}) AS id
      `;
      userId = rows[0]!.id;
    } else {
      userId = existing[0]!.id;
    }

    patientUserIds.push(userId);

    // Insert a patients row if none exists (create_user does not create one).
    await prisma.$executeRaw`
      INSERT INTO patients (user_id, zip_code, date_of_birth)
      VALUES (${userId}::uuid, '10001', '1985-06-15'::date)
      ON CONFLICT (user_id) DO NOTHING
    `;
  }

  // Resolve the patient id for the first seeded patient (alex) — used by the assessment.
  const alexPatientRows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM patients WHERE user_id = ${patientUserIds[0]!}::uuid
  `;
  const alexPatientId = alexPatientRows[0]!.id;

  // --- Assessment (seeded for patient-alex) --------------------------------
  // Guard on fixed session_id so re-runs skip creation.
  const existingAssessment = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM patient_assessments WHERE session_id = ${SEEDED_PATIENT_SESSION_ID}
  `;
  if (existingAssessment.length === 0) {
    const now = new Date();
    const enc = (v: string): string => encryptField(v, encryptionKey);

    await prisma.$executeRaw`
      INSERT INTO patient_assessments (
        session_id,
        patient_id,
        treatment_category,
        symptom_duration,
        exercise_frequency,
        diet,
        sleep_hours,
        stress_level,
        alcohol_use,
        appointment_preference,
        biological_sex,
        allergy_details,
        other_medications,
        has_prior_treatment,
        willing_lab_work,
        willing_structured_program,
        start_timeline,
        budget_band,
        telehealth_preference,
        pregnant_or_planning,
        taking_prescriptions,
        had_prior_therapy,
        medication_allergies,
        zip_code,
        consent_given,
        consent_version,
        consent_given_at,
        submitted_at
      ) VALUES (
        ${SEEDED_PATIENT_SESSION_ID},
        ${alexPatientId}::uuid,
        'hormone',
        ${enc('6_12_months')},
        ${enc('3_5_per_week')},
        ${enc('balanced')},
        ${enc('7_8_hours')},
        ${enc('moderate')},
        ${enc('occasional')},
        ${enc('either')},
        ${enc('male')},
        NULL,
        NULL,
        true,
        true,
        true,
        '1_3_months',
        '200_500',
        'either',
        false,
        false,
        false,
        false,
        '10001',
        true,
        'v1.0',
        ${now.toISOString()}::timestamptz,
        ${now.toISOString()}::timestamptz
      )
    `;

    // Insert associated goals and symptoms
    const assessmentRows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM patient_assessments WHERE session_id = ${SEEDED_PATIENT_SESSION_ID}
    `;
    const assessmentId = assessmentRows[0]!.id;

    await prisma.$executeRaw`
      INSERT INTO assessment_goals (assessment_id, goal_code)
      VALUES
        (${assessmentId}::uuid, 'energy'),
        (${assessmentId}::uuid, 'weight_loss')
      ON CONFLICT DO NOTHING
    `;

    await prisma.$executeRaw`
      INSERT INTO assessment_symptoms (assessment_id, symptom_code, severity)
      VALUES
        (${assessmentId}::uuid, 'fatigue', 4),
        (${assessmentId}::uuid, 'low_libido', 3)
      ON CONFLICT DO NOTHING
    `;
  }

  // Resolve the assessment id for lead foreign keys.
  const assessmentRows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM patient_assessments WHERE session_id = ${SEEDED_PATIENT_SESSION_ID}
  `;
  const seedAssessmentId = assessmentRows[0]!.id;

  // --- Leads ---------------------------------------------------------------
  // Look up clinic internal UUIDs by slug.
  const vitalityClinic = await prisma.clinic.findUniqueOrThrow({
    where: { slug: 'vitality-hormone-nyc' },
    select: { id: true, webhookUrl: true },
  });
  const apexClinic = await prisma.clinic.findUniqueOrThrow({
    where: { slug: 'apex-peptide-telehealth' },
    select: { id: true },
  });
  const glowClinic = await prisma.clinic.findUniqueOrThrow({
    where: { slug: 'glow-med-spa-miami' },
    select: { id: true },
  });

  type LeadDef = {
    leadId: string;
    clinicId: string;
    assessmentId: string | null;
    patientId: string | null;
    patientFirstName: string;
    patientEmail: string;
    patientZip: string;
    patientPhone: string | null;
    treatmentCategory: string;
    topGoals: string;
    topSymptoms: string;
    budgetBand: string;
    telehealthPreference: string;
    appointmentPreference: string;
    startTimeline: string;
    clinicStatus: string;
    deliveryStatus: string;
  };

  const leadDefs: LeadDef[] = [
    {
      leadId: SEEDED_LEAD_IDS[0]!,
      clinicId: vitalityClinic.id,
      assessmentId: seedAssessmentId,
      patientId: alexPatientId,
      patientFirstName: 'Alex',
      patientEmail: 'patient-alex@medalign-seed.example.com',
      patientZip: '10001',
      patientPhone: '555-867-5309',
      treatmentCategory: 'hormone',
      topGoals: 'energy,weight_loss',
      topSymptoms: 'fatigue,low_libido',
      budgetBand: '200_500',
      telehealthPreference: 'either',
      appointmentPreference: 'either',
      startTimeline: '1_3_months',
      clinicStatus: 'booked',
      deliveryStatus: 'sent_to_crm',
    },
    {
      leadId: SEEDED_LEAD_IDS[1]!,
      clinicId: apexClinic.id,
      assessmentId: seedAssessmentId,
      patientId: alexPatientId,
      patientFirstName: 'Alex',
      patientEmail: 'patient-alex@medalign-seed.example.com',
      patientZip: '10001',
      patientPhone: '555-867-5309',
      treatmentCategory: 'hormone',
      topGoals: 'energy,weight_loss',
      topSymptoms: 'fatigue,low_libido',
      budgetBand: '200_500',
      telehealthPreference: 'either',
      appointmentPreference: 'either',
      startTimeline: '1_3_months',
      clinicStatus: 'contacted',
      deliveryStatus: 'sent_to_crm',
    },
    {
      leadId: SEEDED_LEAD_IDS[2]!,
      clinicId: vitalityClinic.id,
      assessmentId: null,
      patientId: null,
      patientFirstName: 'Sam',
      patientEmail: 'patient-sam@medalign-seed.example.com',
      patientZip: '90001',
      patientPhone: '555-222-3344',
      treatmentCategory: 'hormone',
      topGoals: 'energy',
      topSymptoms: 'fatigue',
      budgetBand: '200_500',
      telehealthPreference: 'telehealth',
      appointmentPreference: 'telehealth',
      startTimeline: 'asap',
      clinicStatus: 'new',
      deliveryStatus: 'pending',
    },
    {
      leadId: SEEDED_LEAD_IDS[3]!,
      clinicId: glowClinic.id,
      assessmentId: null,
      patientId: null,
      patientFirstName: 'Sam',
      patientEmail: 'patient-sam@medalign-seed.example.com',
      patientZip: '90001',
      patientPhone: null,
      treatmentCategory: 'med_spa',
      topGoals: 'skin_health',
      topSymptoms: 'acne',
      budgetBand: '500_1k',
      telehealthPreference: 'in_person',
      appointmentPreference: 'in_person',
      startTimeline: '1_3_months',
      clinicStatus: 'new',
      deliveryStatus: 'pending',
    },
  ];

  const existingLeadIds = await prisma.$queryRaw<{ lead_id: string }[]>`
    SELECT lead_id FROM leads WHERE lead_id = ANY(${SEEDED_LEAD_IDS as string[]}::text[])
  `;
  const existingLeadIdSet = new Set(existingLeadIds.map((r) => r.lead_id));

  const receivedAt = new Date('2026-07-01T10:00:00Z');

  for (const def of leadDefs) {
    if (existingLeadIdSet.has(def.leadId)) continue;

    const encryptedPhone =
      def.patientPhone !== null ? encryptField(def.patientPhone, encryptionKey) : null;

    // Build nullable UUID fragments using Prisma.sql to avoid injection and
    // to correctly emit NULL vs a cast uuid literal.
    const assessmentIdSql =
      def.assessmentId !== null ? Prisma.sql`${def.assessmentId}::uuid` : Prisma.sql`NULL::uuid`;
    const patientIdSql =
      def.patientId !== null ? Prisma.sql`${def.patientId}::uuid` : Prisma.sql`NULL::uuid`;

    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO leads (
        lead_id,
        clinic_id,
        assessment_id,
        patient_id,
        patient_first_name,
        patient_email,
        patient_zip,
        patient_phone,
        treatment_category,
        top_goals,
        top_symptoms,
        budget_band,
        telehealth_preference,
        appointment_preference,
        start_timeline,
        lead_source,
        delivery_status,
        clinic_status,
        received_at
      ) VALUES (
        ${def.leadId},
        ${def.clinicId}::uuid,
        ${assessmentIdSql},
        ${patientIdSql},
        ${def.patientFirstName},
        ${def.patientEmail},
        ${def.patientZip},
        ${encryptedPhone},
        ${def.treatmentCategory},
        ${def.topGoals},
        ${def.topSymptoms},
        ${def.budgetBand},
        ${def.telehealthPreference},
        ${def.appointmentPreference},
        ${def.startTimeline},
        'assessment',
        ${def.deliveryStatus},
        ${def.clinicStatus},
        ${receivedAt.toISOString()}::timestamptz
      )
    `);
  }

  // --- Webhook deliveries --------------------------------------------------
  // One delivery for lead #1 (vitality-hormone-nyc, booked, sent_to_crm).
  // Idempotent: delete-then-insert within a transaction scoped to just this lead's
  // deliveries so re-runs don't stack extra rows.
  const vitalityLeadRow = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM leads WHERE lead_id = ${SEEDED_LEAD_IDS[0]!}
  `;
  if (vitalityLeadRow.length > 0) {
    const leadPkId = vitalityLeadRow[0]!.id;
    await prisma.$transaction([
      prisma.$executeRaw`
        DELETE FROM webhook_deliveries WHERE lead_id = ${leadPkId}::uuid
      `,
      prisma.$executeRaw`
        INSERT INTO webhook_deliveries (lead_id, url, status, response_code, error, attempted_at)
        VALUES (
          ${leadPkId}::uuid,
          ${vitalityClinic.webhookUrl ?? 'https://vitalityhormone.example.com/webhooks/medalign'},
          'success',
          200,
          NULL,
          ${'2026-07-01T10:00:05Z'}::timestamptz
        )
      `,
    ]);
  }

  // --- Clinic photos -------------------------------------------------------
  // Two photos for glow-med-spa-miami. Delete-then-insert is idempotent and
  // mirrors how the app's replacePhotos logic works.
  const photoUrls = [
    'https://images.medalign-seed.example.com/glow-med-spa-miami/exterior.jpg',
    'https://images.medalign-seed.example.com/glow-med-spa-miami/treatment-room.jpg',
  ];
  await prisma.$transaction([
    prisma.$executeRaw`
      DELETE FROM clinic_photos WHERE clinic_id = ${glowClinic.id}::uuid
    `,
    prisma.$executeRaw`
      INSERT INTO clinic_photos (clinic_id, url, display_order)
      VALUES
        (${glowClinic.id}::uuid, ${photoUrls[0]!}, 0),
        (${glowClinic.id}::uuid, ${photoUrls[1]!}, 1)
    `,
    prisma.$executeRaw`
      UPDATE clinics SET photo_count = 2 WHERE id = ${glowClinic.id}::uuid
    `,
  ]);

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

  // --- Superadmin user -------------------------------------------------------
  // Seed a superadmin-role user for testing/using admin endpoints.
  // Idempotent: skips creation if the email already exists, then ensures
  // role=superadmin is set and the default 'patient' role is removed.
  {
    const existingAdmin = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM users WHERE email = ${SEEDED_ADMIN_USER.email}::citext
    `;

    let adminUserId: string;
    if (existingAdmin.length === 0) {
      const passwordHash = await argon2.hash(SEEDED_ADMIN_USER.password, {
        type: argon2.argon2id,
      });
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT create_user(${SEEDED_ADMIN_USER.email}::citext, ${passwordHash}) AS id
      `;
      adminUserId = rows[0]!.id;
    } else {
      adminUserId = existingAdmin[0]!.id;
    }

    // Ensure the user has exactly the 'superadmin' role.
    await prisma.$executeRaw`
      INSERT INTO user_roles (user_id, role)
      VALUES (${adminUserId}::uuid, 'superadmin')
      ON CONFLICT (user_id, role) DO NOTHING
    `;
    await prisma.$executeRaw`
      DELETE FROM user_roles WHERE user_id = ${adminUserId}::uuid AND role = 'patient'
    `;
  }

  // --- Sample pending clinic applications ------------------------------------
  // Seeds 2 pending clinic_applications (each with categories + services) so
  // the admin review workflow has data to operate on.
  // Idempotent: guarded on contact_email — skip if the row already exists, then
  // delete-and-recreate child rows so re-runs never duplicate categories/services.

  const SAMPLE_APPLICATIONS = [
    {
      clinicName: 'Horizon Hormone Health',
      contactEmail: 'apply@horizon-hormone-health.example.com',
      businessEmail: 'billing@horizon-hormone-health.example.com',
      city: 'Austin',
      stateCode: 'TX',
      zipCode: '78701',
      websiteUrl: 'https://horizonhormonehealth.example.com',
      telehealthAvailable: true,
      offersLabWork: true,
      newPatientWait: '1-2 weeks',
      npiNumber: '1234567890',
      stateLicenseNumber: 'TX-MED-001',
      consultationFeeBand: '$100-$200',
      monthlyProgramBand: '$200-$400',
      financingAvailable: false,
      insuranceAccepted: false,
      insuranceNotes: null as string | null,
      about:
        'Horizon Hormone Health specializes in bioidentical hormone replacement therapy and peptide protocols for men and women seeking to optimize their vitality.',
      differentiators: 'Board-certified endocrinologist on staff; same-week lab processing.',
      providerName: 'Dr. Elena Voss, MD',
      credentials: 'MD, Board Certified Endocrinology',
      categories: ['hormone', 'peptide'] as const,
      services: [
        { serviceCode: 'testosterone-replacement', isTopService: true, displayOrder: 1 },
        { serviceCode: 'peptide-therapy', isTopService: true, displayOrder: 2 },
        { serviceCode: 'thyroid-optimization', isTopService: false, displayOrder: 3 },
      ],
    },
    {
      clinicName: 'Summit Wellness Collective',
      contactEmail: 'apply@summit-wellness-collective.example.com',
      businessEmail: 'admin@summit-wellness-collective.example.com',
      city: 'Denver',
      stateCode: 'CO',
      zipCode: '80203',
      websiteUrl: 'https://summitwellnesscollective.example.com',
      telehealthAvailable: true,
      offersLabWork: false,
      newPatientWait: '2-3 weeks',
      npiNumber: '0987654321',
      stateLicenseNumber: 'CO-MED-042',
      consultationFeeBand: '$150-$250',
      monthlyProgramBand: '$300-$500',
      financingAvailable: true,
      insuranceAccepted: false,
      insuranceNotes: 'HSA/FSA accepted.',
      about:
        'Summit Wellness Collective offers integrative med-spa and wellness programs including IV therapy, aesthetic treatments, and stress-reduction protocols.',
      differentiators: 'Certified functional medicine practitioners; package pricing available.',
      providerName: 'Dr. Marcus Chen, DO',
      credentials: 'DO, Functional Medicine Certified',
      categories: ['wellness', 'med_spa'] as const,
      services: [
        { serviceCode: 'iv-therapy', isTopService: true, displayOrder: 1 },
        { serviceCode: 'aesthetic-treatments', isTopService: true, displayOrder: 2 },
        { serviceCode: 'stress-reduction', isTopService: false, displayOrder: 3 },
        { serviceCode: 'nutritional-coaching', isTopService: false, displayOrder: 4 },
      ],
    },
  ] as const;

  for (const app of SAMPLE_APPLICATIONS) {
    // Check if this application already exists.
    const existingApp = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM clinic_applications WHERE contact_email = ${app.contactEmail}
    `;

    let applicationId: string;
    if (existingApp.length === 0) {
      const created = await prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO clinic_applications (
          clinic_name, contact_email, business_email, city, state_code, zip_code,
          website_url, telehealth_available, offers_lab_work, new_patient_wait,
          npi_number, state_license_number, consultation_fee_band, monthly_program_band,
          financing_available, insurance_accepted, insurance_notes, about,
          differentiators, provider_name, credentials, status
        ) VALUES (
          ${app.clinicName}, ${app.contactEmail}, ${app.businessEmail},
          ${app.city}, ${app.stateCode}, ${app.zipCode}, ${app.websiteUrl},
          ${app.telehealthAvailable}, ${app.offersLabWork}, ${app.newPatientWait},
          ${app.npiNumber}, ${app.stateLicenseNumber}, ${app.consultationFeeBand},
          ${app.monthlyProgramBand}, ${app.financingAvailable}, ${app.insuranceAccepted},
          ${app.insuranceNotes}, ${app.about}, ${app.differentiators},
          ${app.providerName}, ${app.credentials}, 'pending'
        )
        RETURNING id
      `;
      applicationId = created[0]!.id;
    } else {
      applicationId = existingApp[0]!.id;
    }

    // Delete-then-recreate child rows — keeps them idempotent across re-runs.
    // Wrapped in transactions so a crash cannot leave an application with zero
    // categories or services (mirrors the clinic categories/services pattern).
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        DELETE FROM application_categories WHERE application_id = ${applicationId}::uuid
      `;
      for (const category of app.categories) {
        await tx.$executeRaw`
          INSERT INTO application_categories (application_id, category)
          VALUES (${applicationId}::uuid, ${category}::assessment_category)
          ON CONFLICT (application_id, category) DO NOTHING
        `;
      }
    });

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        DELETE FROM application_services WHERE application_id = ${applicationId}::uuid
      `;
      for (const svc of app.services) {
        await tx.$executeRaw`
          INSERT INTO application_services (application_id, service_code, is_top_service, display_order)
          VALUES (
            ${applicationId}::uuid,
            ${svc.serviceCode},
            ${svc.isTopService},
            ${svc.displayOrder}
          )
        `;
      }
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

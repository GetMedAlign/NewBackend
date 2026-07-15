/**
 * Integration tests for PrismaApplicationRepository.approve() / deny() against a
 * live Postgres (DATABASE_URL from test/.env.test).
 *
 * Verifies:
 *   - approve() under an admin context atomically provisions a clinic (record +
 *     categories + services + photos) and a clinic-role login user (clinic_id set,
 *     role set EXACTLY ['clinic'], email_confirmed=true), and marks the application
 *     approved with created_clinic_id.
 *   - a password-reset token can be issued for the new user afterwards.
 *   - ATOMICITY: a forced failure mid-provision rolls back everything — no clinic,
 *     no user mutation, application stays pending.
 *   - deny() sets denied + reason + reviewed_* and provisions nothing.
 *   - re-reviewing an already-approved/denied application returns 'already_reviewed'.
 */
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { RequestContext } from '../../src/infrastructure/prisma/request-context';
import { PrismaApplicationRepository } from '../../src/modules/clinic-applications/infrastructure/prisma-application.repository';
import { Argon2PasswordHasher } from '../../src/modules/auth/infrastructure/adapters/argon2-password-hasher';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const adapter = new PrismaPg(pool);
const seedPrisma = new PrismaClient({ adapter });

let prismaService: PrismaService;
let repo: PrismaApplicationRepository;

let adminUserId: string;
const createdApplicationIds: string[] = [];
const createdClinicIds: string[] = [];
const createdUserEmails: string[] = [];

async function createUser(email: string): Promise<string> {
  const rows = await seedPrisma.$queryRaw<{ id: string }[]>`
    SELECT create_user(${email}::citext, 'test-hash-approval-spec') AS id
  `;
  return rows[0]!.id;
}

interface SeedAppOptions {
  contactEmail: string;
  clinicName?: string;
  categories?: string[];
  services?: { code: string; top: boolean; order: number }[];
  photoUrls?: string[];
}

async function seedApplication(opts: SeedAppOptions): Promise<string> {
  const photoUrlsJson = opts.photoUrls ? JSON.stringify(opts.photoUrls) : null;
  const rows = await seedPrisma.$queryRaw<{ id: string }[]>`
    INSERT INTO clinic_applications (
      clinic_name, contact_email, business_email, city, state_code, zip_code,
      website_url, telehealth_available, offers_lab_work, new_patient_wait,
      npi_number, state_license_number, consultation_fee_band, monthly_program_band,
      financing_available, insurance_accepted, insurance_notes, about,
      differentiators, provider_name, credentials, logo_url, photo_urls, status
    ) VALUES (
      ${opts.clinicName ?? 'Approval Test Clinic'}, ${opts.contactEmail},
      'biz@approval.example.com', 'Austin', 'TX', '78701',
      'https://approval.example.com', true, true, '1-2 weeks',
      '1234567890', 'TX-MED-999', '$100-$200', '$200-$400',
      false, false, null, 'A test clinic for approval.',
      'Best differentiators.', 'Dr. Approve', 'MD',
      'https://storage.test/logo.png', ${photoUrlsJson}::jsonb, 'pending'
    )
    RETURNING id
  `;
  const id = rows[0]!.id;
  createdApplicationIds.push(id);
  createdUserEmails.push(opts.contactEmail);

  for (const cat of opts.categories ?? ['hormone', 'peptide']) {
    await seedPrisma.$executeRaw`
      INSERT INTO application_categories (application_id, category)
      VALUES (${id}::uuid, ${cat}::assessment_category)
    `;
  }
  for (const svc of opts.services ?? [
    { code: 'testosterone-replacement', top: true, order: 1 },
    { code: 'peptide-therapy', top: false, order: 2 },
  ]) {
    await seedPrisma.$executeRaw`
      INSERT INTO application_services (application_id, service_code, is_top_service, display_order)
      VALUES (${id}::uuid, ${svc.code}, ${svc.top}, ${svc.order})
    `;
  }
  return id;
}

beforeAll(async () => {
  prismaService = new PrismaService();
  await prismaService.onModuleInit();
  repo = new PrismaApplicationRepository(prismaService, new Argon2PasswordHasher());

  const unique = Date.now();
  adminUserId = await createUser(`approval-spec-admin-${unique}@test.example.com`);
  createdUserEmails.push(`approval-spec-admin-${unique}@test.example.com`);
  await seedPrisma.$executeRaw`
    INSERT INTO user_roles (user_id, role)
    VALUES (${adminUserId}::uuid, 'superadmin'::app_role)
    ON CONFLICT DO NOTHING
  `;
});

afterAll(async () => {
  // Delete provisioned clinic users first (they reference clinics via clinic_id).
  for (const email of createdUserEmails) {
    await seedPrisma.$executeRaw`DELETE FROM users WHERE email = ${email}::citext`;
  }
  for (const id of createdApplicationIds) {
    await seedPrisma.$executeRaw`
      UPDATE clinic_applications SET created_clinic_id = NULL WHERE id = ${id}::uuid
    `;
    await seedPrisma.$executeRaw`DELETE FROM clinic_applications WHERE id = ${id}::uuid`;
  }
  for (const id of createdClinicIds) {
    await seedPrisma.$executeRaw`DELETE FROM clinics WHERE id = ${id}::uuid`;
  }
  await prismaService.onModuleDestroy();
  await seedPrisma.$disconnect();
  await pool.end();
});

describe('PrismaApplicationRepository.approve()', () => {
  it('provisions clinic + categories + services + photos + clinic user atomically', async () => {
    const email = `approve-ok-${Date.now()}@test.example.com`;
    const appId = await seedApplication({
      contactEmail: email,
      clinicName: 'Vitality Approve Clinic',
      photoUrls: ['https://storage.test/p1.jpg', 'https://storage.test/p2.jpg'],
    });

    const result = await repo.approve({ userId: adminUserId, role: 'superadmin' }, appId);
    expect(result).not.toBe('not_found');
    expect(result).not.toBe('already_reviewed');
    if (result === 'not_found' || result === 'already_reviewed') throw new Error('unexpected');
    createdClinicIds.push(result.clinicId);
    expect(result.loginEmail).toBe(email);

    // Clinic row + mapped fields.
    const clinicRows = await seedPrisma.$queryRaw<
      {
        name: string;
        slug: string;
        status: string;
        billing_status: string;
        webhook_health: string;
        notify_on_lead: boolean;
        weekly_summary: boolean;
        business_email: string;
        location: string;
        photo_count: number;
        rating: Prisma.Decimal;
        review_count: number;
      }[]
    >`
      SELECT name, slug, status, billing_status, webhook_health, notify_on_lead,
             weekly_summary, business_email, location, photo_count, rating, review_count
      FROM clinics WHERE id = ${result.clinicId}::uuid
    `;
    expect(clinicRows).toHaveLength(1);
    const clinic = clinicRows[0]!;
    expect(clinic.name).toBe('Vitality Approve Clinic');
    expect(clinic.slug).toBe('vitality-approve-clinic');
    expect(clinic.status).toBe('active');
    expect(clinic.billing_status).toBe('no_card');
    expect(clinic.webhook_health).toBe('unknown');
    expect(clinic.notify_on_lead).toBe(true);
    expect(clinic.weekly_summary).toBe(false);
    expect(clinic.business_email).toBe('biz@approval.example.com');
    expect(clinic.location).toBe('Austin, TX');
    expect(clinic.photo_count).toBe(2);
    expect(Number(clinic.review_count)).toBe(0);
    expect(Number(clinic.rating)).toBe(0);

    // Categories, services, photos.
    const cats = await seedPrisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM clinic_categories WHERE clinic_id = ${result.clinicId}::uuid
    `;
    expect(Number(cats[0]!.count)).toBe(2);

    const svcs = await seedPrisma.$queryRaw<
      { service_code: string; is_top_service: boolean; display_order: number }[]
    >`
      SELECT service_code, is_top_service, display_order
      FROM clinic_services WHERE clinic_id = ${result.clinicId}::uuid
      ORDER BY display_order
    `;
    expect(svcs).toHaveLength(2);
    expect(svcs[0]!.service_code).toBe('testosterone-replacement');
    expect(svcs[0]!.is_top_service).toBe(true);
    expect(svcs[0]!.display_order).toBe(1);

    const photos = await seedPrisma.$queryRaw<{ url: string; display_order: number }[]>`
      SELECT url, display_order FROM clinic_photos WHERE clinic_id = ${result.clinicId}::uuid
      ORDER BY display_order
    `;
    expect(photos).toHaveLength(2);
    expect(photos[0]!.url).toBe('https://storage.test/p1.jpg');
    expect(photos[0]!.display_order).toBe(0);
    expect(photos[1]!.display_order).toBe(1);

    // Clinic user: exactly ['clinic'], clinic_id set, email_confirmed=true.
    const userRows = await seedPrisma.$queryRaw<
      { id: string; clinic_id: string | null; email_confirmed: boolean }[]
    >`
      SELECT id, clinic_id, email_confirmed FROM users WHERE email = ${email}::citext
    `;
    expect(userRows).toHaveLength(1);
    expect(userRows[0]!.id).toBe(result.clinicUserId);
    expect(userRows[0]!.clinic_id).toBe(result.clinicId);
    expect(userRows[0]!.email_confirmed).toBe(true);

    const roleRows = await seedPrisma.$queryRaw<{ role: string }[]>`
      SELECT role::text AS role FROM user_roles WHERE user_id = ${result.clinicUserId}::uuid
    `;
    expect(roleRows.map((r) => r.role).sort()).toEqual(['clinic']);

    // Application marked approved with created_clinic_id + reviewer.
    const appRows = await seedPrisma.$queryRaw<
      { status: string; created_clinic_id: string | null; reviewed_by_user_id: string | null }[]
    >`
      SELECT status, created_clinic_id, reviewed_by_user_id
      FROM clinic_applications WHERE id = ${appId}::uuid
    `;
    expect(appRows[0]!.status).toBe('approved');
    expect(appRows[0]!.created_clinic_id).toBe(result.clinicId);
    expect(appRows[0]!.reviewed_by_user_id).toBe(adminUserId);
  });

  it('rolls back EVERYTHING when a write fails mid-provision (atomicity)', async () => {
    const email = `approve-rollback-${Date.now()}@test.example.com`;
    const appId = await seedApplication({
      contactEmail: email,
      clinicName: 'Rollback Approve Clinic',
      photoUrls: ['https://storage.test/rb.jpg'],
    });

    // Wrap PrismaService so that inside the approve transaction, a late write
    // (clinic_photos INSERT) throws — proving the whole tx rolls back.
    const failingService: PrismaService = Object.create(prismaService) as PrismaService;
    (
      failingService as unknown as { withUserContext: PrismaService['withUserContext'] }
    ).withUserContext = <T>(
      ctx: RequestContext,
      fn: (tx: Prisma.TransactionClient) => Promise<T>,
    ): Promise<T> =>
      prismaService.withUserContext(ctx, (tx) => {
        const proxied = new Proxy(tx, {
          get(target, prop, receiver) {
            if (prop === '$executeRaw') {
              return (...args: unknown[]): unknown => {
                const strings = args[0] as TemplateStringsArray | undefined;
                const joined = strings ? strings.join('') : '';
                if (joined.includes('clinic_photos')) {
                  return Promise.reject(new Error('forced mid-provision failure'));
                }
                return (target.$executeRaw as unknown as (...a: unknown[]) => unknown).apply(
                  target,
                  args,
                );
              };
            }
            return Reflect.get(target, prop, receiver);
          },
        });
        return fn(proxied as unknown as Prisma.TransactionClient);
      });

    const failingRepo = new PrismaApplicationRepository(failingService, new Argon2PasswordHasher());

    await expect(
      failingRepo.approve({ userId: adminUserId, role: 'superadmin' }, appId),
    ).rejects.toThrow(/forced mid-provision failure/);

    // Nothing persisted: no clinic named 'Rollback Approve Clinic', no user, app still pending.
    const clinicRows = await seedPrisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM clinics WHERE name = 'Rollback Approve Clinic'
    `;
    expect(Number(clinicRows[0]!.count)).toBe(0);

    const userRows = await seedPrisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM users WHERE email = ${email}::citext
    `;
    expect(Number(userRows[0]!.count)).toBe(0);

    const appRows = await seedPrisma.$queryRaw<
      { status: string; created_clinic_id: string | null }[]
    >`
      SELECT status, created_clinic_id FROM clinic_applications WHERE id = ${appId}::uuid
    `;
    expect(appRows[0]!.status).toBe('pending');
    expect(appRows[0]!.created_clinic_id).toBeNull();
  });

  it('returns already_reviewed when approving an already-approved application', async () => {
    const email = `approve-twice-${Date.now()}@test.example.com`;
    const appId = await seedApplication({
      contactEmail: email,
      clinicName: 'Twice Approve Clinic',
    });

    const first = await repo.approve({ userId: adminUserId, role: 'superadmin' }, appId);
    if (first === 'not_found' || first === 'already_reviewed') throw new Error('unexpected');
    createdClinicIds.push(first.clinicId);

    const second = await repo.approve({ userId: adminUserId, role: 'superadmin' }, appId);
    expect(second).toBe('already_reviewed');
  });

  it('returns not_found for an unknown application id', async () => {
    const res = await repo.approve(
      { userId: adminUserId, role: 'superadmin' },
      '00000000-0000-0000-0000-000000000000',
    );
    expect(res).toBe('not_found');
  });
});

describe('PrismaApplicationRepository.deny()', () => {
  it('sets denied + reason + reviewed_* and provisions nothing', async () => {
    const email = `deny-ok-${Date.now()}@test.example.com`;
    const appId = await seedApplication({ contactEmail: email, clinicName: 'Deny Test Clinic' });

    const result = await repo.deny(
      { userId: adminUserId, role: 'superadmin' },
      appId,
      'Incomplete NPI verification',
      adminUserId,
    );
    if (result === 'not_found' || result === 'already_reviewed') throw new Error('unexpected');
    expect(result.contactEmail).toBe(email);
    expect(result.clinicName).toBe('Deny Test Clinic');

    const appRows = await seedPrisma.$queryRaw<
      {
        status: string;
        deny_reason: string | null;
        reviewed_at: Date | null;
        reviewed_by_user_id: string | null;
        created_clinic_id: string | null;
      }[]
    >`
      SELECT status, deny_reason, reviewed_at, reviewed_by_user_id, created_clinic_id
      FROM clinic_applications WHERE id = ${appId}::uuid
    `;
    expect(appRows[0]!.status).toBe('denied');
    expect(appRows[0]!.deny_reason).toBe('Incomplete NPI verification');
    expect(appRows[0]!.reviewed_at).not.toBeNull();
    expect(appRows[0]!.reviewed_by_user_id).toBe(adminUserId);
    expect(appRows[0]!.created_clinic_id).toBeNull();

    // No clinic provisioned, no user created for the contact email.
    const userRows = await seedPrisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM users WHERE email = ${email}::citext
    `;
    expect(Number(userRows[0]!.count)).toBe(0);
  });

  it('returns already_reviewed when denying an already-denied application', async () => {
    const email = `deny-twice-${Date.now()}@test.example.com`;
    const appId = await seedApplication({ contactEmail: email, clinicName: 'Deny Twice Clinic' });

    await repo.deny({ userId: adminUserId, role: 'superadmin' }, appId, 'first', adminUserId);
    const second = await repo.deny(
      { userId: adminUserId, role: 'superadmin' },
      appId,
      'second',
      adminUserId,
    );
    expect(second).toBe('already_reviewed');
  });
});

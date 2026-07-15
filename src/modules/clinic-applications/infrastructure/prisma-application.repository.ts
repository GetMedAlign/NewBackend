import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  PASSWORD_HASHER,
  type PasswordHasherPort,
} from '../../auth/domain/ports/password-hasher.port';
import { toSlug, withSlugSuffix } from '../domain/slug';
import type {
  AdminReadCtx,
  ApplicationDetail,
  ApplicationRepositoryPort,
  ApplicationServiceItem,
  ApplicationSummary,
  ApproveResult,
  DenyResult,
  ReviewFailure,
  SubmitApplicationInput,
} from '../domain/ports/application-repository.port';

type SummaryRow = {
  id: string;
  clinic_name: string;
  contact_email: string;
  city: string | null;
  state_code: string | null;
  status: string;
  created_at: Date;
  reviewed_at: Date | null;
};

type DetailRow = {
  id: string;
  clinic_name: string;
  contact_email: string;
  business_email: string | null;
  city: string | null;
  state_code: string | null;
  zip_code: string | null;
  website_url: string | null;
  telehealth_available: boolean;
  offers_lab_work: boolean;
  new_patient_wait: string | null;
  npi_number: string | null;
  state_license_number: string | null;
  consultation_fee_band: string | null;
  monthly_program_band: string | null;
  financing_available: boolean;
  insurance_accepted: boolean;
  insurance_notes: string | null;
  about: string | null;
  differentiators: string | null;
  provider_name: string | null;
  credentials: string | null;
  logo_url: string | null;
  photo_urls: unknown;
  status: string;
  created_at: Date;
  reviewed_at: Date | null;
};

type CategoryRow = { category: string };
type ServiceRow = { service_code: string; is_top_service: boolean; display_order: number };

type ApproveAppRow = {
  status: string;
  clinic_name: string;
  contact_email: string;
  business_email: string | null;
  city: string | null;
  state_code: string | null;
  website_url: string | null;
  telehealth_available: boolean;
  offers_lab_work: boolean;
  new_patient_wait: string | null;
  npi_number: string | null;
  state_license_number: string | null;
  consultation_fee_band: string | null;
  monthly_program_band: string | null;
  financing_available: boolean;
  insurance_accepted: boolean;
  insurance_notes: string | null;
  about: string | null;
  differentiators: string | null;
  provider_name: string | null;
  credentials: string | null;
  logo_url: string | null;
  photo_urls: unknown;
};

type DenyAppRow = { status: string; contact_email: string; clinic_name: string };

@Injectable()
export class PrismaApplicationRepository implements ApplicationRepositoryPort {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasherPort,
  ) {}

  async create(input: SubmitApplicationInput): Promise<{ applicationId: string }> {
    return this.prisma.asSystem((client) =>
      client.$transaction(async (tx) => {
        const application = await tx.clinicApplication.create({
          data: {
            clinicName: input.clinicName,
            contactEmail: input.contactEmail,
            businessEmail: input.businessEmail ?? null,
            city: input.city ?? null,
            stateCode: input.stateCode ?? null,
            zipCode: input.zipCode ?? null,
            websiteUrl: input.websiteUrl ?? null,
            telehealthAvailable: input.telehealthAvailable ?? false,
            offersLabWork: input.offersLabWork ?? false,
            newPatientWait: input.newPatientWait ?? null,
            npiNumber: input.npiNumber ?? null,
            stateLicenseNumber: input.stateLicenseNumber ?? null,
            consultationFeeBand: input.consultationFeeBand ?? null,
            monthlyProgramBand: input.monthlyProgramBand ?? null,
            financingAvailable: input.financingAvailable ?? false,
            insuranceAccepted: input.insuranceAccepted ?? false,
            insuranceNotes: input.insuranceNotes ?? null,
            about: input.about ?? null,
            differentiators: input.differentiators ?? null,
            providerName: input.providerName ?? null,
            credentials: input.credentials ?? null,
            logoUrl: input.logoUrl ?? null,
            photoUrls:
              input.photoUrls != null
                ? (input.photoUrls as unknown as Prisma.InputJsonValue)
                : Prisma.DbNull,
            status: 'pending',
          },
          select: { id: true },
        });

        if (input.categories.length > 0) {
          await tx.$executeRaw`
            INSERT INTO application_categories (application_id, category)
            SELECT ${application.id}::uuid, unnest(${input.categories}::assessment_category[])
            ON CONFLICT (application_id, category) DO NOTHING
          `;
        }

        if (input.services.length > 0) {
          await tx.applicationService.createMany({
            data: input.services.map((svc) => ({
              applicationId: application.id,
              serviceCode: svc.serviceCode,
              isTopService: svc.isTopService,
              displayOrder: svc.displayOrder,
            })),
          });
        }

        return { applicationId: application.id };
      }),
    );
  }

  async list(ctx: AdminReadCtx): Promise<ApplicationSummary[]> {
    return this.prisma.withUserContext({ userId: ctx.userId, role: ctx.role, ip: null }, (tx) =>
      tx.$queryRaw<SummaryRow[]>`
        SELECT
          id,
          clinic_name      AS "clinic_name",
          contact_email    AS "contact_email",
          city,
          state_code       AS "state_code",
          status,
          created_at       AS "created_at",
          reviewed_at      AS "reviewed_at"
        FROM clinic_applications
        ORDER BY created_at DESC
      `.then((rows) =>
        rows.map((r) => ({
          id: r.id,
          clinicName: r.clinic_name,
          contactEmail: r.contact_email,
          city: r.city,
          stateCode: r.state_code,
          status: r.status,
          createdAt: r.created_at,
          reviewedAt: r.reviewed_at,
        })),
      ),
    );
  }

  async findById(ctx: AdminReadCtx, id: string): Promise<ApplicationDetail | null> {
    return this.prisma.withUserContext(
      { userId: ctx.userId, role: ctx.role, ip: null },
      async (tx) => {
        const rows = await tx.$queryRaw<DetailRow[]>`
        SELECT
          id,
          clinic_name           AS "clinic_name",
          contact_email         AS "contact_email",
          business_email        AS "business_email",
          city,
          state_code            AS "state_code",
          zip_code              AS "zip_code",
          website_url           AS "website_url",
          telehealth_available  AS "telehealth_available",
          offers_lab_work       AS "offers_lab_work",
          new_patient_wait      AS "new_patient_wait",
          npi_number            AS "npi_number",
          state_license_number  AS "state_license_number",
          consultation_fee_band AS "consultation_fee_band",
          monthly_program_band  AS "monthly_program_band",
          financing_available   AS "financing_available",
          insurance_accepted    AS "insurance_accepted",
          insurance_notes       AS "insurance_notes",
          about,
          differentiators,
          provider_name         AS "provider_name",
          credentials,
          logo_url              AS "logo_url",
          photo_urls            AS "photo_urls",
          status,
          created_at            AS "created_at",
          reviewed_at           AS "reviewed_at"
        FROM clinic_applications
        WHERE id = ${id}::uuid
      `;

        if (rows.length === 0) return null;
        const row = rows[0]!;

        const categoryRows = await tx.$queryRaw<CategoryRow[]>`
        SELECT category::text AS category
        FROM application_categories
        WHERE application_id = ${id}::uuid
        ORDER BY category
      `;

        const serviceRows = await tx.$queryRaw<ServiceRow[]>`
        SELECT
          service_code    AS "service_code",
          is_top_service  AS "is_top_service",
          display_order   AS "display_order"
        FROM application_services
        WHERE application_id = ${id}::uuid
        ORDER BY display_order ASC, service_code ASC
      `;

        const services: ApplicationServiceItem[] = serviceRows.map((s) => ({
          serviceCode: s.service_code,
          isTopService: s.is_top_service,
          displayOrder: s.display_order,
        }));

        const photoUrls = Array.isArray(row.photo_urls)
          ? (row.photo_urls as string[])
          : row.photo_urls != null
            ? null
            : null;

        return {
          id: row.id,
          clinicName: row.clinic_name,
          contactEmail: row.contact_email,
          businessEmail: row.business_email,
          city: row.city,
          stateCode: row.state_code,
          zipCode: row.zip_code,
          websiteUrl: row.website_url,
          telehealthAvailable: row.telehealth_available,
          offersLabWork: row.offers_lab_work,
          newPatientWait: row.new_patient_wait,
          npiNumber: row.npi_number,
          stateLicenseNumber: row.state_license_number,
          consultationFeeBand: row.consultation_fee_band,
          monthlyProgramBand: row.monthly_program_band,
          financingAvailable: row.financing_available,
          insuranceAccepted: row.insurance_accepted,
          insuranceNotes: row.insurance_notes,
          about: row.about,
          differentiators: row.differentiators,
          providerName: row.provider_name,
          credentials: row.credentials,
          logoUrl: row.logo_url,
          photoUrls,
          status: row.status,
          createdAt: row.created_at,
          reviewedAt: row.reviewed_at,
          categories: categoryRows.map((c) => c.category),
          services,
        };
      },
    );
  }

  async approve(ctx: AdminReadCtx, applicationId: string): Promise<ApproveResult | ReviewFailure> {
    return this.prisma.withUserContext(
      { userId: ctx.userId, role: ctx.role, ip: null },
      async (tx): Promise<ApproveResult | ReviewFailure> => {
        // 1. Re-read + lock the application row inside the tx (avoids races).
        const appRows = await tx.$queryRaw<ApproveAppRow[]>`
          SELECT
            status,
            clinic_name           AS "clinic_name",
            contact_email         AS "contact_email",
            business_email        AS "business_email",
            city,
            state_code            AS "state_code",
            website_url           AS "website_url",
            telehealth_available  AS "telehealth_available",
            offers_lab_work       AS "offers_lab_work",
            new_patient_wait      AS "new_patient_wait",
            npi_number            AS "npi_number",
            state_license_number  AS "state_license_number",
            consultation_fee_band AS "consultation_fee_band",
            monthly_program_band  AS "monthly_program_band",
            financing_available   AS "financing_available",
            insurance_accepted    AS "insurance_accepted",
            insurance_notes       AS "insurance_notes",
            about,
            differentiators,
            provider_name         AS "provider_name",
            credentials,
            logo_url              AS "logo_url",
            photo_urls            AS "photo_urls"
          FROM clinic_applications
          WHERE id = ${applicationId}::uuid
          FOR UPDATE
        `;

        if (appRows.length === 0) return 'not_found';
        const app = appRows[0]!;
        if (app.status === 'approved' || app.status === 'denied') return 'already_reviewed';

        const categoryRows = await tx.$queryRaw<{ category: string }[]>`
          SELECT category::text AS category
          FROM application_categories
          WHERE application_id = ${applicationId}::uuid
        `;
        const serviceRows = await tx.$queryRaw<
          { service_code: string; is_top_service: boolean; display_order: number }[]
        >`
          SELECT service_code AS "service_code", is_top_service AS "is_top_service",
                 display_order AS "display_order"
          FROM application_services
          WHERE application_id = ${applicationId}::uuid
        `;
        const photoUrls: string[] = Array.isArray(app.photo_urls)
          ? (app.photo_urls as string[])
          : [];

        // 2. Create the clinic row with a unique slug.
        const baseSlug = toSlug(app.clinic_name) || 'clinic';
        const existingSlugs = await tx.$queryRaw<{ slug: string }[]>`
          SELECT slug FROM clinics WHERE slug = ${baseSlug}
        `;
        const slug =
          existingSlugs.length === 0
            ? baseSlug
            : withSlugSuffix(baseSlug, randomBytes(4).toString('hex'));

        const location = app.city && app.state_code ? `${app.city}, ${app.state_code}` : null;

        const clinic = await tx.clinic.create({
          data: {
            slug,
            name: app.clinic_name,
            about: app.about,
            differentiators: app.differentiators,
            providerName: app.provider_name,
            websiteUrl: app.website_url,
            city: app.city,
            stateCode: app.state_code,
            telehealthAvailable: app.telehealth_available,
            offersLabWork: app.offers_lab_work,
            newPatientWait: app.new_patient_wait,
            npiNumber: app.npi_number,
            stateLicenseNumber: app.state_license_number,
            consultationFeeBand: app.consultation_fee_band,
            monthlyProgramBand: app.monthly_program_band,
            financingAvailable: app.financing_available,
            acceptsInsurance: app.insurance_accepted,
            insuranceNotes: app.insurance_notes,
            credentials: app.credentials,
            businessEmail: app.business_email ?? app.contact_email,
            webhookUrl: null,
            logoUrl: app.logo_url,
            location,
            status: 'active',
            billingStatus: 'no_card',
            notifyOnLead: true,
            webhookHealth: 'unknown',
            webhookSecret: null,
            weeklySummary: false,
            rating: new Prisma.Decimal(0),
            reviewCount: 0,
            photoCount: photoUrls.length,
          },
          select: { id: true },
        });

        // 3. Insert clinic categories / services / photos.
        for (const c of categoryRows) {
          await tx.$executeRaw`
            INSERT INTO clinic_categories (clinic_id, category)
            VALUES (${clinic.id}::uuid, ${c.category}::assessment_category)
            ON CONFLICT (clinic_id, category) DO NOTHING
          `;
        }
        if (serviceRows.length > 0) {
          await tx.clinicService.createMany({
            data: serviceRows.map((s) => ({
              clinicId: clinic.id,
              serviceCode: s.service_code,
              isTopService: s.is_top_service,
              displayOrder: s.display_order,
            })),
          });
        }
        for (let i = 0; i < photoUrls.length; i++) {
          await tx.$executeRaw`
            INSERT INTO clinic_photos (clinic_id, url, display_order)
            VALUES (${clinic.id}::uuid, ${photoUrls[i]}, ${i})
          `;
        }

        // 4. Provision the clinic login user.
        const loginEmail = app.contact_email;
        const existingUser = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM users WHERE email = ${loginEmail}::citext
        `;
        let clinicUserId: string;
        if (existingUser.length > 0) {
          // Existing-email path: associate the existing user.
          clinicUserId = existingUser[0]!.id;

          // Role swap: exactly ['clinic'] + clinic_id + email confirmed.
          await tx.$executeRaw`
            INSERT INTO user_roles (user_id, role)
            VALUES (${clinicUserId}::uuid, 'clinic')
            ON CONFLICT (user_id, role) DO NOTHING
          `;
          await tx.$executeRaw`
            DELETE FROM user_roles WHERE user_id = ${clinicUserId}::uuid AND role = 'patient'
          `;
          await tx.$executeRaw`
            UPDATE users
            SET clinic_id = ${clinic.id}::uuid, email_confirmed = true
            WHERE id = ${clinicUserId}::uuid
          `;
        } else {
          // New-user path: direct admin INSERT (no create_user SECURITY DEFINER needed).
          // Hash is computed here (lazy) so the existing-email path never pays the argon2 cost.
          const throwawayHash = await this.hasher.hash(randomBytes(24).toString('hex'));
          const created = await tx.$queryRaw<{ id: string }[]>`
            INSERT INTO users (email, password_hash, updated_at, email_confirmed, clinic_id)
            VALUES (
              ${loginEmail}::citext,
              ${throwawayHash},
              now(),
              true,
              ${clinic.id}::uuid
            )
            RETURNING id
          `;
          clinicUserId = created[0]!.id;

          // Insert exactly the clinic role — no default patient role, so no delete needed.
          await tx.$executeRaw`
            INSERT INTO user_roles (user_id, role)
            VALUES (${clinicUserId}::uuid, 'clinic')
          `;
        }

        // 5. Mark the application approved.
        await tx.$executeRaw`
          UPDATE clinic_applications
          SET status = 'approved',
              reviewed_at = now(),
              reviewed_by_user_id = ${ctx.userId}::uuid,
              created_clinic_id = ${clinic.id}::uuid
          WHERE id = ${applicationId}::uuid
        `;

        return { clinicId: clinic.id, clinicUserId, loginEmail };
      },
    );
  }

  async deny(
    ctx: AdminReadCtx,
    applicationId: string,
    denyReason: string | null,
    adminId: string,
  ): Promise<DenyResult | ReviewFailure> {
    return this.prisma.withUserContext(
      { userId: ctx.userId, role: ctx.role, ip: null },
      async (tx): Promise<DenyResult | ReviewFailure> => {
        const rows = await tx.$queryRaw<DenyAppRow[]>`
          SELECT status, contact_email AS "contact_email", clinic_name AS "clinic_name"
          FROM clinic_applications
          WHERE id = ${applicationId}::uuid
          FOR UPDATE
        `;
        if (rows.length === 0) return 'not_found';
        const app = rows[0]!;
        if (app.status === 'approved' || app.status === 'denied') return 'already_reviewed';

        await tx.$executeRaw`
          UPDATE clinic_applications
          SET status = 'denied',
              deny_reason = ${denyReason},
              reviewed_at = now(),
              reviewed_by_user_id = ${adminId}::uuid
          WHERE id = ${applicationId}::uuid
        `;

        return { contactEmail: app.contact_email, clinicName: app.clinic_name };
      },
    );
  }
}

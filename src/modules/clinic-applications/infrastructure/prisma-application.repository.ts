import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  AdminReadCtx,
  ApplicationDetail,
  ApplicationRepositoryPort,
  ApplicationServiceItem,
  ApplicationSummary,
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

@Injectable()
export class PrismaApplicationRepository implements ApplicationRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

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
}

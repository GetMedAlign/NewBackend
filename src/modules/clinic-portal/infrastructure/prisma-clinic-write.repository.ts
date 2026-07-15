import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  ClinicWriteRepositoryPort,
  ClinicProfileView,
  UpdateClinicProfilePatch,
  ClinicServiceView,
} from '../domain/ports/clinic-write-repository.port';

type ClinicRow = {
  id: string;
  slug: string;
  name: string;
  about: string | null;
  providerName: string | null;
  websiteUrl: string | null;
  city: string | null;
  stateCode: string | null;
  location: string | null;
  businessEmail: string | null;
  webhookUrl: string | null;
  webhookSecret: string | null;
  notifyOnLead: boolean;
  differentiators: string | null;
  offersLabWork: boolean;
  insuranceNotes: string | null;
  credentials: string | null;
  npiNumber: string | null;
  stateLicenseNumber: string | null;
  logoUrl: string | null;
  photoCount: number;
  weeklySummary: boolean;
  webhookHealth: string;
  billingStatus: string;
  suspensionReason: string | null;
  telehealthAvailable: boolean;
  newPatientWait: string | null;
  consultationFeeBand: string | null;
  monthlyProgramBand: string | null;
  financingAvailable: boolean;
  acceptsInsurance: boolean;
  rating: number | { toNumber(): number };
  reviewCount: number;
};

type CategoryRow = { category: string };
type ServiceRow = { service_code: string; is_top_service: boolean; display_order: number };
type LeadAggRow = { count: string; max_date: Date | null };
type LocationRow = { city: string | null; state_code: string | null };

@Injectable()
export class PrismaClinicWriteRepository implements ClinicWriteRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findProfile(clinicId: string): Promise<ClinicProfileView | null> {
    return this.prisma.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId },
      async (tx) => {
        const clinicRows = await tx.$queryRaw<ClinicRow[]>`
          SELECT
            id, slug, name, about,
            provider_name          AS "providerName",
            website_url            AS "websiteUrl",
            city,
            state_code             AS "stateCode",
            location,
            business_email         AS "businessEmail",
            webhook_url            AS "webhookUrl",
            webhook_secret         AS "webhookSecret",
            notify_on_lead         AS "notifyOnLead",
            differentiators,
            offers_lab_work        AS "offersLabWork",
            insurance_notes        AS "insuranceNotes",
            credentials,
            npi_number             AS "npiNumber",
            state_license_number   AS "stateLicenseNumber",
            logo_url               AS "logoUrl",
            photo_count            AS "photoCount",
            weekly_summary         AS "weeklySummary",
            webhook_health         AS "webhookHealth",
            billing_status         AS "billingStatus",
            suspension_reason      AS "suspensionReason",
            telehealth_available   AS "telehealthAvailable",
            new_patient_wait       AS "newPatientWait",
            consultation_fee_band  AS "consultationFeeBand",
            monthly_program_band   AS "monthlyProgramBand",
            financing_available    AS "financingAvailable",
            accepts_insurance      AS "acceptsInsurance",
            rating,
            review_count           AS "reviewCount"
          FROM clinics
          WHERE id = ${clinicId}::uuid
        `;

        if (clinicRows.length === 0) return null;
        const clinic = clinicRows[0]!;

        const categoryRows = await tx.$queryRaw<CategoryRow[]>`
          SELECT category FROM clinic_categories
          WHERE clinic_id = ${clinicId}::uuid
        `;

        const serviceRows = await tx.$queryRaw<ServiceRow[]>`
          SELECT service_code, is_top_service, display_order
          FROM clinic_services
          WHERE clinic_id = ${clinicId}::uuid
          ORDER BY display_order ASC, service_code ASC
        `;

        const leadAgg = await tx.$queryRaw<LeadAggRow[]>`
          SELECT count(*)::text AS count, max(received_at) AS max_date
          FROM leads
          WHERE clinic_id = ${clinicId}::uuid
        `;

        const leadCount = Number(leadAgg[0]?.count ?? 0);
        const lastLeadAt = leadAgg[0]?.max_date ?? null;

        const services: ClinicServiceView[] = serviceRows.map((s) => ({
          serviceCode: s.service_code,
          isTopService: s.is_top_service,
          displayOrder: s.display_order,
        }));

        return {
          id: clinic.id,
          slug: clinic.slug,
          name: clinic.name,
          about: clinic.about,
          providerName: clinic.providerName,
          websiteUrl: clinic.websiteUrl,
          city: clinic.city,
          stateCode: clinic.stateCode,
          location: clinic.location,
          businessEmail: clinic.businessEmail,
          webhookUrl: clinic.webhookUrl,
          webhookSecret: clinic.webhookSecret,
          notifyOnLead: clinic.notifyOnLead,
          differentiators: clinic.differentiators,
          offersLabWork: clinic.offersLabWork,
          insuranceNotes: clinic.insuranceNotes,
          credentials: clinic.credentials,
          npiNumber: clinic.npiNumber,
          stateLicenseNumber: clinic.stateLicenseNumber,
          logoUrl: clinic.logoUrl,
          photoCount: Number(clinic.photoCount),
          weeklySummary: clinic.weeklySummary,
          webhookHealth: clinic.webhookHealth,
          billingStatus: clinic.billingStatus,
          suspensionReason: clinic.suspensionReason,
          telehealthAvailable: clinic.telehealthAvailable,
          newPatientWait: clinic.newPatientWait,
          consultationFeeBand: clinic.consultationFeeBand,
          monthlyProgramBand: clinic.monthlyProgramBand,
          financingAvailable: clinic.financingAvailable,
          acceptsInsurance: clinic.acceptsInsurance,
          rating:
            typeof clinic.rating === 'object' && 'toNumber' in clinic.rating
              ? clinic.rating.toNumber()
              : Number(clinic.rating),
          reviewCount: Number(clinic.reviewCount),
          treatmentCategories: categoryRows.map((c) => c.category),
          services,
          leadCount,
          lastLeadAt,
        };
      },
    );
  }

  async updateProfile(clinicId: string, patch: UpdateClinicProfilePatch): Promise<void> {
    await this.prisma.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId },
      async (tx) => {
        // --- 1. Build partial UPDATE for scalar clinic fields ---
        const cols: string[] = [];
        const vals: (string | boolean | number | null)[] = [];

        const add = (col: string, val: string | boolean | number | null): void => {
          cols.push(`"${col}" = $${cols.length + 1}`);
          vals.push(val);
        };

        if (patch.name !== undefined) add('name', patch.name);
        if (patch.about !== undefined) add('about', patch.about);
        if (patch.providerName !== undefined) add('provider_name', patch.providerName);
        if (patch.websiteUrl !== undefined) add('website_url', patch.websiteUrl);
        if (patch.businessEmail !== undefined) add('business_email', patch.businessEmail);
        if (patch.webhookUrl !== undefined) add('webhook_url', patch.webhookUrl);
        if (patch.notifyOnLead !== undefined) add('notify_on_lead', patch.notifyOnLead);
        if (patch.differentiators !== undefined) add('differentiators', patch.differentiators);
        if (patch.offersLabWork !== undefined) add('offers_lab_work', patch.offersLabWork);
        if (patch.insuranceNotes !== undefined) add('insurance_notes', patch.insuranceNotes);
        if (patch.credentials !== undefined) add('credentials', patch.credentials);
        if (patch.npiNumber !== undefined) add('npi_number', patch.npiNumber);
        if (patch.stateLicenseNumber !== undefined)
          add('state_license_number', patch.stateLicenseNumber);
        if (patch.weeklySummary !== undefined) add('weekly_summary', patch.weeklySummary);
        if (patch.telehealthAvailable !== undefined)
          add('telehealth_available', patch.telehealthAvailable);
        if (patch.newPatientWait !== undefined) add('new_patient_wait', patch.newPatientWait);
        if (patch.consultationFeeBand !== undefined)
          add('consultation_fee_band', patch.consultationFeeBand);
        if (patch.monthlyProgramBand !== undefined)
          add('monthly_program_band', patch.monthlyProgramBand);
        if (patch.financingAvailable !== undefined)
          add('financing_available', patch.financingAvailable);
        if (patch.acceptsInsurance !== undefined) add('accepts_insurance', patch.acceptsInsurance);
        if (patch.city !== undefined) add('city', patch.city);
        if (patch.stateCode !== undefined) add('state_code', patch.stateCode);

        const cityOrStateChanged = patch.city !== undefined || patch.stateCode !== undefined;

        if (cols.length > 0) {
          const idIdx = cols.length + 1;
          const sql = `UPDATE clinics SET ${cols.join(', ')} WHERE id = $${idIdx}::uuid`;
          await tx.$executeRawUnsafe(sql, ...vals, clinicId);
        }

        // Recompute location after city/state updates
        if (cityOrStateChanged) {
          const rows = await tx.$queryRaw<LocationRow[]>`
            SELECT city, state_code FROM clinics WHERE id = ${clinicId}::uuid
          `;
          if (rows.length > 0) {
            const { city, state_code } = rows[0]!;
            if (city && state_code) {
              const loc = `${city}, ${state_code}`;
              await tx.$executeRaw`
                UPDATE clinics SET location = ${loc} WHERE id = ${clinicId}::uuid
              `;
            }
          }
        }

        // --- 2. Replace treatment categories if provided ---
        if (patch.treatmentCategories !== undefined && patch.treatmentCategories.length > 0) {
          await tx.$executeRaw`
            DELETE FROM clinic_categories WHERE clinic_id = ${clinicId}::uuid
          `;
          for (const cat of patch.treatmentCategories) {
            await tx.$executeRawUnsafe(
              `INSERT INTO clinic_categories (clinic_id, category)
               VALUES ($1::uuid, $2::assessment_category)`,
              clinicId,
              cat,
            );
          }
        }

        // --- 3. Replace services if topServices or allServices provided ---
        if (patch.topServices !== undefined || patch.allServices !== undefined) {
          await tx.$executeRaw`
            DELETE FROM clinic_services WHERE clinic_id = ${clinicId}::uuid
          `;

          const topServices = patch.topServices ?? [];
          const allServices = patch.allServices ?? [];
          const topSet = new Set(topServices);

          for (let i = 0; i < topServices.length; i++) {
            await tx.$executeRaw`
              INSERT INTO clinic_services (clinic_id, service_code, is_top_service, display_order)
              VALUES (${clinicId}::uuid, ${topServices[i]}, true, ${i})
            `;
          }

          let order = topServices.length;
          for (const code of allServices.filter((s) => !topSet.has(s))) {
            await tx.$executeRaw`
              INSERT INTO clinic_services (clinic_id, service_code, is_top_service, display_order)
              VALUES (${clinicId}::uuid, ${code}, false, ${order})
            `;
            order++;
          }
        }
      },
    );
  }
}

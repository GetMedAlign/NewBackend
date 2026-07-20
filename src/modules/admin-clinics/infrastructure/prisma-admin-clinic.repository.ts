import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { AdminCtx } from '../../../infrastructure/security/admin-ctx';
import {
  toAdminClinicDto,
  type AdminClinicDto,
  type AdminClinicRow,
  type ClinicServiceRow,
} from '../domain/clinic-dto.mapper';
import type {
  AdminClinicRepositoryPort,
  UpdateClinicInput,
} from '../domain/ports/admin-clinic-repository.port';
import type { AdminLeadRow } from './http/dto/admin-lead-row.dto';

type CategoryRow = { clinic_id: string; category: string };
type ServiceJoinRow = ClinicServiceRow & { clinic_id: string };
type LeadStatsRow = { clinic_id: string; count: bigint; last_at: Date | null };

/** Raw row shape from the §1.4 query, before the timestamp/null conversions. */
type LeadQueryRow = {
  lead_id: string;
  received_at: Date;
  patientFirstName: string;
  patientEmail: string;
  patientZip: string | null;
  treatmentCategory: string;
  delivery_status: string;
  clinic_status: string;
};

@Injectable()
export class PrismaAdminClinicRepository implements AdminClinicRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async listClinics(ctx: AdminCtx): Promise<AdminClinicDto[]> {
    return this.prisma.withUserContext(
      { userId: ctx.userId, role: ctx.role, ip: ctx.ip },
      async (tx) => {
        const clinics = await tx.$queryRaw<AdminClinicRow[]>`
          SELECT id, slug, name, location, city, state_code AS "state_code",
                 zip_code AS "zip_code", rating, review_count AS "review_count",
                 about, differentiators, new_patient_wait AS "new_patient_wait",
                 telehealth_available AS "telehealth_available",
                 offers_lab_work AS "offers_lab_work", website_url AS "website_url",
                 consultation_fee_band AS "consultation_fee_band",
                 monthly_program_band AS "monthly_program_band",
                 financing_available AS "financing_available",
                 accepts_insurance AS "accepts_insurance",
                 insurance_notes AS "insurance_notes", provider_name AS "provider_name",
                 credentials, photo_count AS "photo_count", status,
                 created_at AS "created_at", billing_status AS "billing_status",
                 webhook_health AS "webhook_health", suspension_reason AS "suspension_reason"
            FROM clinics
           ORDER BY name ASC`;

        const cats = await tx.$queryRaw<CategoryRow[]>`
          SELECT clinic_id AS "clinic_id", category FROM clinic_categories`;

        const svcs = await tx.$queryRaw<ServiceJoinRow[]>`
          SELECT clinic_id AS "clinic_id", service_code AS "service_code",
                 is_top_service AS "is_top_service", display_order AS "display_order"
            FROM clinic_services`;

        const stats = await tx.$queryRaw<LeadStatsRow[]>`
          SELECT clinic_id AS "clinic_id", COUNT(*) AS count, MAX(received_at) AS "last_at"
            FROM leads GROUP BY clinic_id`;

        return buildClinicDtos(clinics, cats, svcs, stats);
      },
    );
  }

  async getClinic(ctx: AdminCtx, clinicId: string): Promise<AdminClinicDto | null> {
    return this.prisma.withUserContext(
      { userId: ctx.userId, role: ctx.role, ip: ctx.ip },
      async (tx) => {
        const clinics = await tx.$queryRaw<AdminClinicRow[]>`
          SELECT id, slug, name, location, city, state_code AS "state_code",
                 zip_code AS "zip_code", rating, review_count AS "review_count",
                 about, differentiators, new_patient_wait AS "new_patient_wait",
                 telehealth_available AS "telehealth_available",
                 offers_lab_work AS "offers_lab_work", website_url AS "website_url",
                 consultation_fee_band AS "consultation_fee_band",
                 monthly_program_band AS "monthly_program_band",
                 financing_available AS "financing_available",
                 accepts_insurance AS "accepts_insurance",
                 insurance_notes AS "insurance_notes", provider_name AS "provider_name",
                 credentials, photo_count AS "photo_count", status,
                 created_at AS "created_at", billing_status AS "billing_status",
                 webhook_health AS "webhook_health", suspension_reason AS "suspension_reason"
            FROM clinics
           WHERE id = ${clinicId}::uuid`;

        if (clinics.length === 0) return null;

        const cats = await tx.$queryRaw<CategoryRow[]>`
          SELECT clinic_id AS "clinic_id", category
            FROM clinic_categories
           WHERE clinic_id = ${clinicId}::uuid`;

        const svcs = await tx.$queryRaw<ServiceJoinRow[]>`
          SELECT clinic_id AS "clinic_id", service_code AS "service_code",
                 is_top_service AS "is_top_service", display_order AS "display_order"
            FROM clinic_services
           WHERE clinic_id = ${clinicId}::uuid`;

        const stats = await tx.$queryRaw<LeadStatsRow[]>`
          SELECT clinic_id AS "clinic_id", COUNT(*) AS count, MAX(received_at) AS "last_at"
            FROM leads
           WHERE clinic_id = ${clinicId}::uuid
           GROUP BY clinic_id`;

        const dtos = buildClinicDtos(clinics, cats, svcs, stats);
        return dtos[0] ?? null;
      },
    );
  }

  async updateClinic(ctx: AdminCtx, clinicId: string, input: UpdateClinicInput): Promise<boolean> {
    return this.prisma.withUserContext(
      { userId: ctx.userId, role: ctx.role, ip: ctx.ip },
      async (tx) => {
        const sets: Prisma.Sql[] = [];
        if (input.name !== undefined) sets.push(Prisma.sql`name = ${input.name}`);
        if (input.status !== undefined) sets.push(Prisma.sql`status = ${input.status}`);
        if (input.about !== undefined) sets.push(Prisma.sql`about = ${input.about}`);
        if (input.differentiators !== undefined) {
          sets.push(Prisma.sql`differentiators = ${input.differentiators}`);
        }
        if (input.providerName !== undefined) {
          sets.push(Prisma.sql`provider_name = ${input.providerName}`);
        }
        if (input.credentials !== undefined) {
          sets.push(Prisma.sql`credentials = ${input.credentials}`);
        }
        if (input.websiteUrl !== undefined) {
          sets.push(Prisma.sql`website_url = ${input.websiteUrl}`);
        }
        if (input.city !== undefined) sets.push(Prisma.sql`city = ${input.city}`);
        if (input.stateCode !== undefined) {
          sets.push(Prisma.sql`state_code = ${input.stateCode}`);
        }
        if (input.zipCode !== undefined) sets.push(Prisma.sql`zip_code = ${input.zipCode}`);
        if (input.telehealth !== undefined) {
          sets.push(Prisma.sql`telehealth_available = ${input.telehealth}`);
        }
        if (input.offersLabWork !== undefined) {
          sets.push(Prisma.sql`offers_lab_work = ${input.offersLabWork}`);
        }
        if (input.financing !== undefined) {
          sets.push(Prisma.sql`financing_available = ${input.financing}`);
        }
        if (input.insurance !== undefined) {
          sets.push(Prisma.sql`accepts_insurance = ${input.insurance}`);
        }
        if (input.insuranceNotes !== undefined) {
          sets.push(Prisma.sql`insurance_notes = ${input.insuranceNotes}`);
        }
        if (input.consultationFee !== undefined) {
          sets.push(Prisma.sql`consultation_fee_band = ${input.consultationFee}`);
        }
        if (input.monthlyProgram !== undefined) {
          sets.push(Prisma.sql`monthly_program_band = ${input.monthlyProgram}`);
        }
        if (input.waitTime !== undefined) {
          sets.push(Prisma.sql`new_patient_wait = ${input.waitTime}`);
        }
        if (input.rating !== undefined) sets.push(Prisma.sql`rating = ${input.rating}`);
        if (input.reviewCount !== undefined) {
          sets.push(Prisma.sql`review_count = ${input.reviewCount}`);
        }
        if (input.isListedInDirectory !== undefined) {
          sets.push(Prisma.sql`is_listed_in_directory = ${input.isListedInDirectory}`);
        }
        if (input.logoUrl !== undefined) sets.push(Prisma.sql`logo_url = ${input.logoUrl}`);

        if (sets.length === 0) {
          const exists = await tx.$queryRaw<{ exists: number }[]>`
            SELECT 1 AS exists FROM clinics WHERE id = ${clinicId}::uuid`;
          return exists.length > 0;
        }

        const result = await tx.$executeRaw`
          UPDATE clinics SET ${Prisma.join(sets, ', ')} WHERE id = ${clinicId}::uuid`;
        if (result === 0) return false;

        if (input.city !== undefined || input.stateCode !== undefined) {
          await tx.$executeRaw`
            UPDATE clinics SET location = concat(city, ', ', state_code)
             WHERE id = ${clinicId}::uuid`;
        }

        return true;
      },
    );
  }

  async pauseDelivery(ctx: AdminCtx, clinicId: string, paused: boolean): Promise<boolean> {
    return this.prisma.withUserContext(
      { userId: ctx.userId, role: ctx.role, ip: ctx.ip },
      async (tx) => {
        const exists = await tx.$queryRaw<{ exists: number }[]>`
          SELECT 1 AS exists FROM clinics WHERE id = ${clinicId}::uuid`;
        if (exists.length === 0) return false;

        // All SET expressions in this single UPDATE see the pre-update row,
        // so both CASE arms below read the old `status` value (spec §1.3).
        await tx.$executeRaw`
          UPDATE clinics
             SET status = CASE WHEN ${paused} THEN 'paused'
                               WHEN status = 'paused' THEN 'active'
                               ELSE status END,
                 notify_on_lead = CASE WHEN ${paused} THEN false
                                       WHEN status = 'paused' THEN true
                                       ELSE notify_on_lead END
           WHERE id = ${clinicId}::uuid`;

        return true;
      },
    );
  }

  async clinicExists(ctx: AdminCtx, clinicId: string): Promise<boolean> {
    return this.prisma.withUserContext(
      { userId: ctx.userId, role: ctx.role, ip: ctx.ip },
      async (tx) => {
        const rows = await tx.$queryRaw<{ exists: number }[]>`
          SELECT 1 AS exists FROM clinics WHERE id = ${clinicId}::uuid`;
        return rows.length > 0;
      },
    );
  }

  async listClinicLeads(ctx: AdminCtx, clinicId: string): Promise<AdminLeadRow[]> {
    return this.prisma.withUserContext(
      { userId: ctx.userId, role: ctx.role, ip: ctx.ip },
      async (tx) => {
        const rows = await tx.$queryRaw<LeadQueryRow[]>`
          SELECT lead_id            AS "lead_id",
                 received_at        AS "received_at",
                 patient_first_name AS "patientFirstName",
                 patient_email      AS "patientEmail",
                 patient_zip        AS "patientZip",
                 treatment_category AS "treatmentCategory",
                 delivery_status    AS "delivery_status",
                 clinic_status      AS "clinic_status"
            FROM leads
           WHERE clinic_id = ${clinicId}::uuid
           ORDER BY received_at DESC`;

        return rows.map((row): AdminLeadRow => ({
          lead_id: row.lead_id,
          received_at: row.received_at.toISOString(),
          patientFirstName: row.patientFirstName,
          patientEmail: row.patientEmail,
          patientZip: row.patientZip ?? '',
          treatmentCategory: row.treatmentCategory,
          delivery_status: row.delivery_status,
          clinic_status: row.clinic_status,
        }));
      },
    );
  }
}

/** Groups categories/services/lead-stats by clinic_id and maps each clinic row to a DTO. */
function buildClinicDtos(
  clinics: AdminClinicRow[],
  cats: CategoryRow[],
  svcs: ServiceJoinRow[],
  stats: LeadStatsRow[],
): AdminClinicDto[] {
  const catsByClinic = new Map<string, string[]>();
  for (const c of cats) {
    const list = catsByClinic.get(c.clinic_id);
    if (list) list.push(c.category);
    else catsByClinic.set(c.clinic_id, [c.category]);
  }

  const svcsByClinic = new Map<string, ClinicServiceRow[]>();
  for (const s of svcs) {
    const row: ClinicServiceRow = {
      service_code: s.service_code,
      is_top_service: s.is_top_service,
      display_order: s.display_order,
    };
    const list = svcsByClinic.get(s.clinic_id);
    if (list) list.push(row);
    else svcsByClinic.set(s.clinic_id, [row]);
  }

  const statsByClinic = new Map<string, { count: number; lastAt: Date | null }>();
  for (const s of stats) {
    statsByClinic.set(s.clinic_id, { count: Number(s.count), lastAt: s.last_at });
  }

  return clinics.map((row) => {
    const stat = statsByClinic.get(row.id);
    return toAdminClinicDto(
      row,
      catsByClinic.get(row.id) ?? [],
      svcsByClinic.get(row.id) ?? [],
      stat?.count ?? 0,
      stat?.lastAt ?? null,
    );
  });
}

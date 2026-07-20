import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { AdminCtx } from '../../../infrastructure/security/admin-ctx';
import {
  toAdminClinicDto,
  type AdminClinicDto,
  type AdminClinicRow,
  type ClinicServiceRow,
} from '../domain/clinic-dto.mapper';
import type { AdminClinicRepositoryPort } from '../domain/ports/admin-clinic-repository.port';

type CategoryRow = { clinic_id: string; category: string };
type ServiceJoinRow = ClinicServiceRow & { clinic_id: string };
type LeadStatsRow = { clinic_id: string; count: bigint; last_at: Date | null };

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

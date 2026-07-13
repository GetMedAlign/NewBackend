import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { ClinicRepositoryPort } from '../domain/ports/clinic-repository.port';
import type { ClinicReadModel } from '../domain/clinic.entity';

/**
 * Row shape returned by the joined clinic queries.
 * Uses snake_case to match raw SQL column aliases.
 */
interface ClinicRow {
  id: string;
  slug: string;
  name: string;
  about: string;
  provider_name: string;
  website_url: string;
  city: string | null;
  state_code: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Prisma Decimal comes back as string from $queryRaw; we parse it. */
  rating: string | number | null;
  review_count: number | null;
  telehealth_available: boolean | null;
  new_patient_wait: string | null;
  consultation_fee_band: string | null;
  monthly_program_band: string | null;
  financing_available: boolean | null;
  accepts_insurance: boolean | null;
  status: string | null;
  billing_status: string | null;
  business_email: string | null;
  webhook_url: string | null;
  notify_on_lead: boolean | null;
  webhook_secret: string | null;
}

const EXCLUDED_BILLING_STATUSES = ['no_card', 'overdue'];

@Injectable()
export class PrismaClinicRepository implements ClinicRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns all clinics eligible for matching:
   *   - status = 'active'
   *   - billing_status NOT IN ('no_card', 'overdue')
   *   - has a clinic_categories row for the given category
   *
   * Also attaches categories[] and services[] arrays.
   */
  async findMatchable(category: string): Promise<ClinicReadModel[]> {
    const clinics = await this.prisma.asSystem(
      (client) =>
        client.$queryRaw<ClinicRow[]>`
        SELECT
          c.id,
          c.slug,
          c.name,
          c.about,
          c.provider_name,
          c.website_url,
          c.city,
          c.state_code,
          c.latitude,
          c.longitude,
          c.rating,
          c.review_count,
          c.telehealth_available,
          c.new_patient_wait,
          c.consultation_fee_band,
          c.monthly_program_band,
          c.financing_available,
          c.accepts_insurance,
          c.status,
          c.billing_status,
          c.business_email,
          c.webhook_url,
          c.notify_on_lead,
          c.webhook_secret
        FROM clinics c
        WHERE
          c.status = 'active'
          AND c.billing_status NOT IN (${EXCLUDED_BILLING_STATUSES[0]}, ${EXCLUDED_BILLING_STATUSES[1]})
          AND EXISTS (
            SELECT 1 FROM clinic_categories cc
            WHERE cc.clinic_id = c.id AND cc.category = ${category}
          )
      `,
    );

    return Promise.all(clinics.map((row) => this.attachRelations(row)));
  }

  async findById(id: string): Promise<ClinicReadModel | null> {
    const rows = await this.prisma.asSystem(
      (client) =>
        client.$queryRaw<ClinicRow[]>`
        SELECT
          c.id,
          c.slug,
          c.name,
          c.about,
          c.provider_name,
          c.website_url,
          c.city,
          c.state_code,
          c.latitude,
          c.longitude,
          c.rating,
          c.review_count,
          c.telehealth_available,
          c.new_patient_wait,
          c.consultation_fee_band,
          c.monthly_program_band,
          c.financing_available,
          c.accepts_insurance,
          c.status,
          c.billing_status,
          c.business_email,
          c.webhook_url,
          c.notify_on_lead,
          c.webhook_secret
        FROM clinics c
        WHERE c.id = ${id}::uuid
        LIMIT 1
      `,
    );

    if (!rows[0]) return null;
    return this.attachRelations(rows[0]);
  }

  async findBySlug(slug: string): Promise<ClinicReadModel | null> {
    const rows = await this.prisma.asSystem(
      (client) =>
        client.$queryRaw<ClinicRow[]>`
        SELECT
          c.id,
          c.slug,
          c.name,
          c.about,
          c.provider_name,
          c.website_url,
          c.city,
          c.state_code,
          c.latitude,
          c.longitude,
          c.rating,
          c.review_count,
          c.telehealth_available,
          c.new_patient_wait,
          c.consultation_fee_band,
          c.monthly_program_band,
          c.financing_available,
          c.accepts_insurance,
          c.status,
          c.billing_status,
          c.business_email,
          c.webhook_url,
          c.notify_on_lead,
          c.webhook_secret
        FROM clinics c
        WHERE c.slug = ${slug}
        LIMIT 1
      `,
    );

    if (!rows[0]) return null;
    return this.attachRelations(rows[0]);
  }

  /**
   * Fetches the categories and services for a clinic row and returns the
   * assembled ClinicReadModel.
   */
  private async attachRelations(row: ClinicRow): Promise<ClinicReadModel> {
    const [categoryRows, serviceRows] = await Promise.all([
      this.prisma.asSystem(
        (client) =>
          client.$queryRaw<{ category: string }[]>`
          SELECT category FROM clinic_categories WHERE clinic_id = ${row.id}::uuid
        `,
      ),
      this.prisma.asSystem(
        (client) =>
          client.$queryRaw<{ service_code: string }[]>`
          SELECT service_code FROM clinic_services WHERE clinic_id = ${row.id}::uuid
        `,
      ),
    ]);

    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      about: row.about,
      providerName: row.provider_name,
      websiteUrl: row.website_url,
      city: row.city,
      state: row.state_code,
      latitude: row.latitude,
      longitude: row.longitude,
      rating: row.rating !== null ? Number(row.rating) : 0,
      reviewCount: row.review_count ?? 0,
      telehealthAvailable: row.telehealth_available ?? false,
      newPatientWait: row.new_patient_wait ?? '',
      consultationFeeBand: row.consultation_fee_band ?? '',
      monthlyProgramBand: row.monthly_program_band ?? '',
      financingAvailable: row.financing_available ?? false,
      acceptsInsurance: row.accepts_insurance ?? false,
      status: row.status ?? '',
      billingStatus: row.billing_status ?? '',
      businessEmail: row.business_email,
      webhookUrl: row.webhook_url,
      notifyOnLead: row.notify_on_lead ?? false,
      webhookSecretEncrypted: row.webhook_secret,
      categories: categoryRows.map((r) => r.category),
      services: serviceRows.map((r) => r.service_code),
    };
  }
}

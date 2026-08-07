import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { ClinicRepositoryPort } from '../domain/ports/clinic-repository.port';
import type { ClinicReadModel } from '../domain/clinic.entity';
import type {
  ClinicDirectoryFilter,
  ClinicDirectoryQueryResult,
  ClinicDirectoryRow,
  ClinicProfileReadModel,
} from '../domain/clinic-directory.types';
import {
  Prisma,
  type Clinic,
  type ClinicCategory,
  type ClinicService,
  type AssessmentCategory,
} from '../../../../generated/prisma/client';

type ClinicWithRelations = Clinic & {
  categories: ClinicCategory[];
  services: ClinicService[];
};

const EXCLUDED_BILLING_STATUSES = ['no_card', 'overdue'];

/** Valid `assessment_category` enum values — guards the raw `::assessment_category` cast. */
const VALID_CATEGORIES = new Set(['hormone', 'peptide', 'med_spa', 'wellness']);

/** Raw row shape returned by the directory listing query, before DTO mapping. */
type RawDirectoryRow = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  stateCode: string | null;
  rating: unknown;
  reviewCount: number;
  telehealthAvailable: boolean;
  consultationFeeBand: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
  distance_miles: number | null;
  totalCount: bigint;
};

/** Raw row shape returned by the profile-by-slug query, before DTO mapping. */
type RawProfileRow = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  stateCode: string | null;
  zipCode: string | null;
  location: string | null;
  rating: unknown;
  reviewCount: number;
  about: string | null;
  differentiators: string | null;
  providerName: string | null;
  credentials: string | null;
  newPatientWait: string | null;
  telehealthAvailable: boolean;
  offersLabWork: boolean;
  websiteUrl: string | null;
  consultationFeeBand: string | null;
  monthlyProgramBand: string | null;
  financingAvailable: boolean;
  acceptsInsurance: boolean;
  photoCount: number;
  logoUrl: string | null;
  tourVideoUrl: string | null;
};

@Injectable()
export class PrismaClinicRepository implements ClinicRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns all clinics eligible for matching:
   *   - status = 'active'
   *   - billingStatus NOT IN ('no_card', 'overdue')
   *   - has a clinic_categories row for the given category
   *
   * Fetches categories and services in a single batched query via Prisma include.
   */
  async findMatchable(category: string): Promise<ClinicReadModel[]> {
    const clinics = await this.prisma.asSystem((client) =>
      client.clinic.findMany({
        where: {
          status: 'active',
          billingStatus: { notIn: EXCLUDED_BILLING_STATUSES },
          categories: { some: { category: category as AssessmentCategory } },
        },
        include: { categories: true, services: true },
      }),
    );

    return clinics.map((row) => this.toReadModel(row));
  }

  async findById(id: string): Promise<ClinicReadModel | null> {
    const row = await this.prisma.asSystem((client) =>
      client.clinic.findUnique({
        where: { id },
        include: { categories: true, services: true },
      }),
    );

    if (!row) return null;
    return this.toReadModel(row);
  }

  async findBySlug(slug: string): Promise<ClinicReadModel | null> {
    const row = await this.prisma.asSystem((client) =>
      client.clinic.findUnique({
        where: { slug },
        include: { categories: true, services: true },
      }),
    );

    if (!row) return null;
    return this.toReadModel(row);
  }

  /**
   * Public, paginated clinic directory (GET /clinics). Mirrors
   * MedAlign-Backend/src/MedAlign.Api/Controllers/ClinicsController.cs#GetDirectory:
   * status/is_listed_in_directory/billing gating, category/state/telehealth/
   * serviceCode/search filters, rating/name/reviews/distance sorting, pagination.
   *
   * Deviation from .NET: .NET resolves clinic coordinates via a join through
   * `zip_codes` (its `Clinic` entity only stores a ZIP). This schema stores
   * `latitude`/`longitude` directly on `clinics` (the same columns the
   * recommendations module already uses for distance), so the distance
   * expression and ORDER BY / pagination run as a single SQL query instead
   * of loading all matching rows into memory to sort.
   */
  async findDirectory(filter: ClinicDirectoryFilter): Promise<ClinicDirectoryQueryResult> {
    // An unrecognised category can never match (clinic_categories.category is
    // a Postgres enum) — short-circuit instead of letting the cast throw.
    if (filter.category !== undefined && !VALID_CATEGORIES.has(filter.category)) {
      return { items: [], totalCount: 0 };
    }

    const conditions: Prisma.Sql[] = [
      Prisma.sql`c.status = 'active'`,
      Prisma.sql`c.is_listed_in_directory = true`,
      Prisma.sql`c.billing_status NOT IN ('no_card', 'overdue')`,
    ];

    if (filter.category !== undefined) {
      conditions.push(
        Prisma.sql`EXISTS (
          SELECT 1 FROM clinic_categories cc
           WHERE cc.clinic_id = c.id AND cc.category = ${filter.category}::assessment_category
        )`,
      );
    }
    if (filter.state !== undefined) {
      conditions.push(Prisma.sql`c.state_code = ${filter.state}`);
    }
    if (filter.telehealth !== undefined) {
      conditions.push(Prisma.sql`c.telehealth_available = ${filter.telehealth}`);
    }
    if (filter.serviceCode !== undefined) {
      conditions.push(
        Prisma.sql`EXISTS (
          SELECT 1 FROM clinic_services cs
           WHERE cs.clinic_id = c.id AND cs.service_code = ${filter.serviceCode}
        )`,
      );
    }
    if (filter.search !== undefined) {
      conditions.push(Prisma.sql`c.name ILIKE ${'%' + filter.search + '%'}`);
    }

    const whereSql = Prisma.join(conditions, ' AND ');

    const hasPatientGeo = filter.patientLat !== null && filter.patientLng !== null;
    const distanceSql = hasPatientGeo
      ? Prisma.sql`
          CASE WHEN c.latitude IS NULL OR c.longitude IS NULL THEN NULL ELSE
            3958.8 * 2 * asin(sqrt(
              power(sin(radians(c.latitude - ${filter.patientLat}) / 2), 2) +
              cos(radians(${filter.patientLat})) * cos(radians(c.latitude)) *
              power(sin(radians(c.longitude - ${filter.patientLng}) / 2), 2)
            ))
          END`
      : Prisma.sql`NULL::double precision`;

    let orderSql: Prisma.Sql;
    if (filter.sortBy === 'distance' && hasPatientGeo) {
      orderSql = Prisma.sql`distance_miles ASC NULLS LAST, c.id ASC`;
    } else if (filter.sortBy === 'name') {
      orderSql = Prisma.sql`c.name ASC, c.id ASC`;
    } else if (filter.sortBy === 'reviews') {
      orderSql = Prisma.sql`c.review_count DESC, c.id ASC`;
    } else {
      // Default (also .NET's default): rating descending.
      orderSql = Prisma.sql`c.rating DESC, c.id ASC`;
    }

    const offset = (filter.page - 1) * filter.pageSize;

    const rows = await this.prisma.asSystem(
      (client) =>
        client.$queryRaw<RawDirectoryRow[]>`
        SELECT c.id, c.slug, c.name, c.city, c.state_code AS "stateCode",
               c.rating, c.review_count AS "reviewCount",
               c.telehealth_available AS "telehealthAvailable",
               c.consultation_fee_band AS "consultationFeeBand",
               c.logo_url AS "logoUrl", c.website_url AS "websiteUrl",
               (${distanceSql}) AS distance_miles,
               count(*) OVER() AS "totalCount"
          FROM clinics c
         WHERE ${whereSql}
         ORDER BY ${orderSql}
         LIMIT ${filter.pageSize} OFFSET ${offset}
      `,
    );

    if (rows.length === 0) return { items: [], totalCount: 0 };

    const ids = rows.map((r) => r.id);
    const idsSql = Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`));

    const [categoryRows, topServiceRows] = await Promise.all([
      this.prisma.asSystem(
        (client) =>
          client.$queryRaw<{ clinicId: string; category: string }[]>`
          SELECT clinic_id AS "clinicId", category
            FROM clinic_categories
           WHERE clinic_id IN (${idsSql})
           ORDER BY ctid
        `,
      ),
      this.prisma.asSystem(
        (client) =>
          client.$queryRaw<{ clinicId: string; serviceCode: string }[]>`
          SELECT clinic_id AS "clinicId", service_code AS "serviceCode"
            FROM clinic_services
           WHERE clinic_id IN (${idsSql}) AND is_top_service = true
           ORDER BY clinic_id, display_order
        `,
      ),
    ]);

    // First category row per clinic (insertion order via ctid) is the "primary"
    // category — same best-effort semantics as .NET's unordered FirstOrDefault().
    const categoryByClinicId = new Map<string, string>();
    for (const row of categoryRows) {
      if (!categoryByClinicId.has(row.clinicId)) categoryByClinicId.set(row.clinicId, row.category);
    }

    const topServicesByClinicId = new Map<string, string[]>();
    for (const row of topServiceRows) {
      const list = topServicesByClinicId.get(row.clinicId) ?? [];
      if (list.length < 3) list.push(row.serviceCode);
      topServicesByClinicId.set(row.clinicId, list);
    }

    const items: ClinicDirectoryRow[] = rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      category: categoryByClinicId.get(row.id) ?? 'wellness',
      city: row.city,
      stateCode: row.stateCode,
      rating: Number(row.rating),
      reviewCount: row.reviewCount,
      telehealthAvailable: row.telehealthAvailable,
      topServices: topServicesByClinicId.get(row.id) ?? [],
      consultationFeeBand: row.consultationFeeBand,
      logoUrl: row.logoUrl,
      websiteUrl: row.websiteUrl,
      distanceMiles: row.distance_miles !== null ? Math.round(row.distance_miles * 10) / 10 : null,
    }));

    return { items, totalCount: Number(rows[0]!.totalCount) };
  }

  /**
   * Public single-clinic profile (GET /clinics/:slug). Mirrors .NET's
   * ClinicsController.GetBySlug: active + billing-current, but (deliberately,
   * like .NET) NOT gated on `is_listed_in_directory` — a de-listed clinic is
   * still reachable by its own direct link.
   */
  async findProfileBySlug(slug: string): Promise<ClinicProfileReadModel | null> {
    const rows = await this.prisma.asSystem(
      (client) =>
        client.$queryRaw<RawProfileRow[]>`
        SELECT c.id, c.slug, c.name, c.city, c.state_code AS "stateCode",
               c.zip_code AS "zipCode", c.location, c.rating,
               c.review_count AS "reviewCount", c.about, c.differentiators,
               c.provider_name AS "providerName", c.credentials,
               c.new_patient_wait AS "newPatientWait",
               c.telehealth_available AS "telehealthAvailable",
               c.offers_lab_work AS "offersLabWork", c.website_url AS "websiteUrl",
               c.consultation_fee_band AS "consultationFeeBand",
               c.monthly_program_band AS "monthlyProgramBand",
               c.financing_available AS "financingAvailable",
               c.accepts_insurance AS "acceptsInsurance",
               c.photo_count AS "photoCount", c.logo_url AS "logoUrl",
               c.tour_video_url AS "tourVideoUrl"
          FROM clinics c
         WHERE c.slug = ${slug}
           AND c.status = 'active'
           AND c.billing_status NOT IN ('no_card', 'overdue')
      `,
    );

    const row = rows[0];
    if (!row) return null;

    const [categoryRows, serviceRows, photoRows] = await Promise.all([
      this.prisma.asSystem(
        (client) =>
          client.$queryRaw<{ category: string }[]>`
          SELECT category FROM clinic_categories WHERE clinic_id = ${row.id}::uuid ORDER BY ctid
        `,
      ),
      this.prisma.asSystem(
        (client) =>
          client.$queryRaw<{ serviceCode: string; isTopService: boolean }[]>`
          SELECT service_code AS "serviceCode", is_top_service AS "isTopService"
            FROM clinic_services
           WHERE clinic_id = ${row.id}::uuid
           ORDER BY (CASE WHEN is_top_service THEN 0 ELSE 1 END), display_order
        `,
      ),
      this.prisma.asSystem(
        (client) =>
          client.$queryRaw<{ url: string }[]>`
          SELECT url FROM clinic_photos WHERE clinic_id = ${row.id}::uuid ORDER BY display_order
        `,
      ),
    ]);

    const topServices = serviceRows.filter((s) => s.isTopService).map((s) => s.serviceCode);
    const allServices = serviceRows.map((s) => s.serviceCode);

    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      category: categoryRows[0]?.category ?? 'wellness',
      location: row.location,
      city: row.city,
      stateCode: row.stateCode,
      zipCode: row.zipCode,
      rating: Number(row.rating),
      reviewCount: row.reviewCount,
      about: row.about ?? '',
      differentiators: row.differentiators ?? '',
      providerName: row.providerName ?? '',
      credentials: row.credentials ?? '',
      topServices,
      allServices,
      waitTime: row.newPatientWait ?? '',
      telehealthAvailable: row.telehealthAvailable,
      offersLabWork: row.offersLabWork,
      websiteUrl: row.websiteUrl,
      consultationFeeBand: row.consultationFeeBand ?? '',
      monthlyProgramBand: row.monthlyProgramBand ?? '',
      financingAvailable: row.financingAvailable,
      acceptsInsurance: row.acceptsInsurance,
      photoCount: row.photoCount,
      logoUrl: row.logoUrl,
      tourVideoUrl: row.tourVideoUrl,
      photoUrls: photoRows.map((p) => p.url),
    };
  }

  private toReadModel(row: ClinicWithRelations): ClinicReadModel {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      about: row.about ?? '',
      providerName: row.providerName ?? '',
      websiteUrl: row.websiteUrl ?? '',
      city: row.city,
      state: row.stateCode,
      latitude: row.latitude,
      longitude: row.longitude,
      rating: row.rating !== null ? Number(row.rating) : 0,
      reviewCount: row.reviewCount ?? 0,
      telehealthAvailable: row.telehealthAvailable ?? false,
      newPatientWait: row.newPatientWait ?? '',
      consultationFeeBand: row.consultationFeeBand ?? '',
      monthlyProgramBand: row.monthlyProgramBand ?? '',
      financingAvailable: row.financingAvailable ?? false,
      acceptsInsurance: row.acceptsInsurance ?? false,
      status: row.status ?? '',
      billingStatus: row.billingStatus ?? '',
      businessEmail: row.businessEmail,
      webhookUrl: row.webhookUrl,
      notifyOnLead: row.notifyOnLead ?? false,
      webhookSecretEncrypted: row.webhookSecret,
      categories: row.categories.map((c) => String(c.category)),
      services: row.services.map((s) => s.serviceCode),
    };
  }
}

import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { LocalizationRepositoryPort } from '../domain/ports/localization-repository.port';
import type {
  LocationRecord,
  LocationStatus,
  RawClinicRecord,
  ServiceCodeMap,
  ServiceRecord,
  ServiceStatus,
} from '../domain/coverage.types';

interface LocationRow {
  slug: string;
  name: string;
  stateCode: string;
  status: string;
  area: string;
  intro: string;
  seoTitle: string;
  seoDescription: string;
  displayOrder: number;
  aliases: string[] | null;
  nearSlugs: string[] | null;
}
interface ServiceRow {
  slug: string;
  name: string;
  description: string;
  status: string;
  seoTitle: string;
  seoDescription: string;
  displayOrder: number;
  relatedSlugs: string[] | null;
}
interface ClinicRow {
  id: string;
  name: string;
  cityText: string | null;
  stateCode: string | null;
  telehealth: boolean;
  services: string[] | null;
}

@Injectable()
export class PrismaLocalizationRepository implements LocalizationRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async loadActiveClinics(): Promise<RawClinicRecord[]> {
    const rows = await this.prisma.asSystem(
      (c) =>
        c.$queryRaw<ClinicRow[]>`
        SELECT c.id,
               c.name,
               c.city           AS "cityText",
               c.state_code     AS "stateCode",
               c.telehealth_available AS "telehealth",
               array_remove(array_agg(cs.service_code), NULL) AS "services"
          FROM clinics c
          LEFT JOIN clinic_services cs ON cs.clinic_id = c.id
         WHERE c.status = 'active'
           AND c.is_listed_in_directory = true
           AND c.billing_status NOT IN ('no_card','overdue')
         GROUP BY c.id`,
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      cityText: r.cityText ?? '',
      stateCode: r.stateCode ?? '',
      services: r.services ?? [],
      telehealth: r.telehealth,
    }));
  }

  async getLocations(includeHidden: boolean): Promise<LocationRecord[]> {
    const notHidden = includeHidden ? Prisma.empty : Prisma.sql`WHERE l.status <> 'hidden'`;
    const rows = await this.prisma.asSystem(
      (c) =>
        c.$queryRaw<LocationRow[]>`
        SELECT l.slug, l.name, l.state_code AS "stateCode", l.status,
               l.area, l.intro, l.seo_title AS "seoTitle", l.seo_description AS "seoDescription",
               l.display_order AS "displayOrder",
               (SELECT array_agg(a.alias) FROM location_alias a WHERE a.location_id = l.id) AS "aliases",
               (SELECT array_agg(n.near_slug ORDER BY n.display_order) FROM location_near n WHERE n.location_id = l.id) AS "nearSlugs"
          FROM location l
         ${notHidden}
         ORDER BY l.display_order`,
    );
    return rows.map((r) => this.toLocation(r));
  }

  async getLocationBySlug(slug: string): Promise<LocationRecord | null> {
    const rows = await this.prisma.asSystem(
      (c) =>
        c.$queryRaw<LocationRow[]>`
        SELECT l.slug, l.name, l.state_code AS "stateCode", l.status,
               l.area, l.intro, l.seo_title AS "seoTitle", l.seo_description AS "seoDescription",
               l.display_order AS "displayOrder",
               (SELECT array_agg(a.alias) FROM location_alias a WHERE a.location_id = l.id) AS "aliases",
               (SELECT array_agg(n.near_slug ORDER BY n.display_order) FROM location_near n WHERE n.location_id = l.id) AS "nearSlugs"
          FROM location l
         WHERE l.slug = ${slug} AND l.status <> 'hidden'
         LIMIT 1`,
    );
    return rows[0] ? this.toLocation(rows[0]) : null;
  }

  async getServices(includeHidden: boolean): Promise<ServiceRecord[]> {
    const activeOnly = includeHidden ? Prisma.empty : Prisma.sql`WHERE s.status = 'active'`;
    const rows = await this.prisma.asSystem(
      (c) =>
        c.$queryRaw<ServiceRow[]>`
        SELECT s.slug, s.name, s.description, s.status,
               s.seo_title AS "seoTitle", s.seo_description AS "seoDescription", s.display_order AS "displayOrder",
               (SELECT array_agg(r.related_slug ORDER BY r.display_order) FROM marketing_service_related r WHERE r.marketing_service_id = s.id) AS "relatedSlugs"
          FROM marketing_service s
         ${activeOnly}
         ORDER BY s.display_order`,
    );
    return rows.map((r) => this.toService(r));
  }

  async getServiceBySlug(slug: string): Promise<ServiceRecord | null> {
    const rows = await this.prisma.asSystem(
      (c) =>
        c.$queryRaw<ServiceRow[]>`
        SELECT s.slug, s.name, s.description, s.status,
               s.seo_title AS "seoTitle", s.seo_description AS "seoDescription", s.display_order AS "displayOrder",
               (SELECT array_agg(r.related_slug ORDER BY r.display_order) FROM marketing_service_related r WHERE r.marketing_service_id = s.id) AS "relatedSlugs"
          FROM marketing_service s
         WHERE s.slug = ${slug} AND s.status <> 'hidden'
         LIMIT 1`,
    );
    return rows[0] ? this.toService(rows[0]) : null;
  }

  async getServiceCodeMap(): Promise<ServiceCodeMap> {
    const rows = await this.prisma.asSystem(
      (c) =>
        c.$queryRaw<{ slug: string; serviceCode: string }[]>`
        SELECT s.slug, msc.service_code AS "serviceCode"
          FROM marketing_service s
          JOIN marketing_service_code msc ON msc.marketing_service_id = s.id`,
    );
    const map: ServiceCodeMap = {};
    for (const r of rows) {
      (map[r.slug] ??= []).push(r.serviceCode);
    }
    return map;
  }

  async getMinClinics(): Promise<number> {
    const rows = await this.prisma.asSystem(
      (c) =>
        c.$queryRaw<{ minClinics: number }[]>`
        SELECT min_clinics AS "minClinics" FROM localization_setting WHERE id = 'default' LIMIT 1`,
    );
    return rows[0] ? Number(rows[0].minClinics) : 2;
  }

  async insertNotify(email: string, citySlug: string | null): Promise<void> {
    await this.prisma.asSystem(
      (c) =>
        c.$executeRaw`INSERT INTO location_notify (email, city_slug) VALUES (${email}, ${citySlug})`,
    );
  }

  private toLocation(r: LocationRow): LocationRecord {
    return {
      slug: r.slug,
      name: r.name,
      stateCode: r.stateCode,
      status: r.status as LocationStatus,
      area: r.area,
      intro: r.intro,
      aliases: r.aliases ?? [],
      nearSlugs: r.nearSlugs ?? [],
      seoTitle: r.seoTitle,
      seoDescription: r.seoDescription,
      displayOrder: Number(r.displayOrder),
    };
  }

  private toService(r: ServiceRow): ServiceRecord {
    return {
      slug: r.slug,
      name: r.name,
      description: r.description,
      status: r.status as ServiceStatus,
      relatedSlugs: r.relatedSlugs ?? [],
      seoTitle: r.seoTitle,
      seoDescription: r.seoDescription,
      displayOrder: Number(r.displayOrder),
    };
  }
}

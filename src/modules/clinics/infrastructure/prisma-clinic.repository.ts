import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { ClinicRepositoryPort } from '../domain/ports/clinic-repository.port';
import type { ClinicReadModel } from '../domain/clinic.entity';
import type {
  Clinic,
  ClinicCategory,
  ClinicService,
  AssessmentCategory,
} from '../../../../generated/prisma/client';

type ClinicWithRelations = Clinic & {
  categories: ClinicCategory[];
  services: ClinicService[];
};

const EXCLUDED_BILLING_STATUSES = ['no_card', 'overdue'];

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

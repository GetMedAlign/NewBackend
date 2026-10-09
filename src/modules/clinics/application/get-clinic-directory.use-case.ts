import { Inject, Injectable } from '@nestjs/common';
import { CLINIC_REPOSITORY, ClinicRepositoryPort } from '../domain/ports/clinic-repository.port';
import { ZipGeocoder } from '../../../infrastructure/geo/zip-geocoder';
import type { ClinicDirectorySortBy } from '../domain/clinic-directory.types';
import type {
  ClinicDirectoryItemDto,
  ClinicDirectoryResponseDto,
} from '../domain/clinic-directory.dto';

const SPECIALTY_BY_CATEGORY: Record<string, string> = {
  hormone: 'Hormone Therapy',
  peptide: 'Peptide Therapy',
  med_spa: 'Med Spa & Aesthetics',
  wellness: 'Integrative Wellness',
};

const VALID_SORT_BY = new Set<ClinicDirectorySortBy>(['rating', 'name', 'reviews', 'distance']);

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

export interface GetClinicDirectoryQuery {
  category?: string;
  state?: string;
  telehealth?: string;
  serviceCode?: string;
  search?: string;
  city?: string;
  zipCode?: string;
  sortBy?: string;
  page?: string;
  pageSize?: string;
}

@Injectable()
export class GetClinicDirectoryUseCase {
  constructor(
    @Inject(CLINIC_REPOSITORY) private readonly clinicRepo: ClinicRepositoryPort,
    private readonly zipGeocoder: ZipGeocoder,
  ) {}

  /**
   * Orchestrates GET /clinics. Query-string parsing/clamping mirrors
   * MedAlign-Backend's ClinicsController.GetDirectory:
   *   - pageSize clamped to [1, 50], page floored at 1
   *   - sortBy defaults to "rating"; unrecognised values fall back to "rating"
   *     too (the .NET switch expression's default arm)
   *   - a resolvable `zipCode` attaches `distanceMiles` to every item
   *     regardless of `sortBy`, but only `sortBy=distance` changes the order
   */
  async execute(query: GetClinicDirectoryQuery): Promise<ClinicDirectoryResponseDto> {
    const page = Math.max(1, parseIntOr(query.page, 1));
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, parseIntOr(query.pageSize, DEFAULT_PAGE_SIZE)),
    );
    const sortByRaw = (query.sortBy ?? 'rating') as ClinicDirectorySortBy;
    const sortBy = VALID_SORT_BY.has(sortByRaw) ? sortByRaw : 'rating';

    const zipCode = nonEmpty(query.zipCode);
    const patientGeo = zipCode ? await this.zipGeocoder.lookup(zipCode) : null;

    const { items, totalCount } = await this.clinicRepo.findDirectory({
      category: nonEmpty(query.category),
      state: nonEmpty(query.state)?.toUpperCase(),
      telehealth: parseBooleanOr(query.telehealth, undefined),
      serviceCode: nonEmpty(query.serviceCode),
      search: nonEmpty(query.search),
      city: nonEmpty(query.city),
      sortBy,
      page,
      pageSize,
      patientLat: patientGeo?.lat ?? null,
      patientLng: patientGeo?.lng ?? null,
    });

    const dtoItems: ClinicDirectoryItemDto[] = items.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      category: row.category,
      specialty: SPECIALTY_BY_CATEGORY[row.category] ?? row.category,
      city: row.city ?? '',
      stateCode: row.stateCode ?? '',
      rating: row.rating,
      reviewCount: row.reviewCount,
      telehealth: row.telehealthAvailable,
      topServices: row.topServices,
      consultationFee: row.consultationFeeBand,
      logoUrl: row.logoUrl,
      websiteUrl: row.websiteUrl,
      distanceMiles: row.distanceMiles,
    }));

    return {
      items: dtoItems,
      totalCount,
      page,
      pageSize,
      totalPages: Math.ceil(totalCount / pageSize),
    };
  }
}

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseIntOr(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBooleanOr(
  value: string | undefined,
  fallback: boolean | undefined,
): boolean | undefined {
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

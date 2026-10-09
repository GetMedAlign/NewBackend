import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CoverageService } from '../domain/coverage.service';
import {
  LOCALIZATION_REPOSITORY,
  type LocalizationRepositoryPort,
} from '../domain/ports/localization-repository.port';
import type { ClinicRecord, LocationRecord } from '../domain/coverage.types';
import type { CityDetailDto, ClinicListItemDto, NamedCountDto } from '../domain/localization.dto';

@Injectable()
export class GetCityUseCase {
  constructor(
    @Inject(LOCALIZATION_REPOSITORY) private readonly repo: LocalizationRepositoryPort,
    private readonly coverage: CoverageService,
  ) {}

  async execute(slug: string): Promise<CityDetailDto> {
    const location = await this.repo.getLocationBySlug(slug);
    if (!location) throw new NotFoundException(`No city '${slug}'`);

    const [raws, locations, services, codeMap, minClinics] = await Promise.all([
      this.repo.loadActiveClinics(),
      this.repo.getLocations(true),
      this.repo.getServices(false),
      this.repo.getServiceCodeMap(),
      this.repo.getMinClinics(),
    ]);
    const clinics = this.coverage.toClinicRecords(raws, locations);
    const local = this.coverage.localClinicsInCity(clinics, location.slug);
    const telehealth = this.coverage.telehealthForCity(clinics, location.slug);
    const published = this.coverage.cityPublished(location, clinics, minClinics);

    const serviceCounts: NamedCountDto[] = services
      .map((s) => ({
        slug: s.slug,
        name: s.name,
        count: this.coverage.clinicsForCombo(clinics, location.slug, codeMap[s.slug] ?? []).length,
      }))
      .filter((x) => x.count > 0);

    const nearby: NamedCountDto[] = location.nearSlugs
      .map((ns) => locations.find((l) => l.slug === ns))
      .filter(
        (l): l is LocationRecord => !!l && this.coverage.cityPublished(l, clinics, minClinics),
      )
      .map((l) => ({
        slug: l.slug,
        name: l.name,
        count: this.coverage.localClinicsInCity(clinics, l.slug).length,
      }));

    return {
      slug: location.slug,
      name: location.name,
      status: location.status,
      published,
      area: location.area,
      intro: location.intro,
      clinics: local.map(toClinicDto),
      telehealthClinics: telehealth.map(toClinicDto),
      services: serviceCounts,
      nearbyCities: nearby,
      meta: {
        path: `/locations/${location.slug}/`,
        title: location.seoTitle,
        description: location.seoDescription,
        robots: published,
      },
    };
  }
}

export function toClinicDto(c: ClinicRecord): ClinicListItemDto {
  return {
    id: c.id,
    name: c.name,
    address: [c.cityText, c.stateCode].filter(Boolean).join(', '),
    services: c.services,
    telehealth: c.telehealth,
  };
}

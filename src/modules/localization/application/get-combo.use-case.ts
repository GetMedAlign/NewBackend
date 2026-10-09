import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CoverageService } from '../domain/coverage.service';
import {
  LOCALIZATION_REPOSITORY,
  type LocalizationRepositoryPort,
} from '../domain/ports/localization-repository.port';
import type { ComboDetailDto } from '../domain/localization.dto';
import { toClinicDto } from './get-city.use-case';

@Injectable()
export class GetComboUseCase {
  constructor(
    @Inject(LOCALIZATION_REPOSITORY) private readonly repo: LocalizationRepositoryPort,
    private readonly coverage: CoverageService,
  ) {}

  async execute(citySlug: string, serviceSlug: string): Promise<ComboDetailDto> {
    const [location, service] = await Promise.all([
      this.repo.getLocationBySlug(citySlug),
      this.repo.getServiceBySlug(serviceSlug),
    ]);
    if (!location || !service) throw new NotFoundException('Unknown city or service');

    const [raws, locations, codeMap, minClinics] = await Promise.all([
      this.repo.loadActiveClinics(),
      this.repo.getLocations(true),
      this.repo.getServiceCodeMap(),
      this.repo.getMinClinics(),
    ]);
    const clinics = this.coverage.toClinicRecords(raws, locations);
    const codes = codeMap[service.slug] ?? [];
    const local = this.coverage.clinicsForCombo(clinics, location.slug, codes);
    const published = this.coverage.comboPublished(location, service, clinics, codes, minClinics);

    const availableNear = new Set(
      locations.filter((l) => l.status === 'available').map((l) => l.slug),
    );
    const nearby =
      local.length < 3
        ? location.nearSlugs
            .filter((ns) => availableNear.has(ns))
            .flatMap((ns) => this.coverage.clinicsForCombo(clinics, ns, codes))
        : [];

    return {
      citySlug: location.slug,
      serviceSlug: service.slug,
      published,
      clinics: local.map(toClinicDto),
      nearbyClinics: nearby.map(toClinicDto),
      meta: {
        path: `/locations/${location.slug}/${service.slug}/`,
        title: `${service.name} in ${location.name}, FL | MedAlign`,
        description: service.seoDescription,
        robots: published,
      },
    };
  }
}

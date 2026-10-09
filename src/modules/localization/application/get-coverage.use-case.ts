import { Inject, Injectable } from '@nestjs/common';
import { CoverageService } from '../domain/coverage.service';
import {
  LOCALIZATION_REPOSITORY,
  type LocalizationRepositoryPort,
} from '../domain/ports/localization-repository.port';
import type { CoverageDto, CoverageRowDto } from '../domain/localization.dto';

@Injectable()
export class GetCoverageUseCase {
  constructor(
    @Inject(LOCALIZATION_REPOSITORY) private readonly repo: LocalizationRepositoryPort,
    private readonly coverage: CoverageService,
  ) {}

  async execute(): Promise<CoverageDto> {
    const [raws, locations, services, codeMap, minClinics] = await Promise.all([
      this.repo.loadActiveClinics(),
      this.repo.getLocations(true),
      this.repo.getServices(true),
      this.repo.getServiceCodeMap(),
      this.repo.getMinClinics(),
    ]);
    const clinics = this.coverage.toClinicRecords(raws, locations);

    const cities = locations.map((l) => ({
      slug: l.slug,
      name: l.name,
      status: l.status,
      published: this.coverage.cityPublished(l, clinics, minClinics),
      clinicCount: this.coverage.localClinicsInCity(clinics, l.slug).length,
    }));

    const matrix: CoverageRowDto[] = services.map((s) => {
      const codes = codeMap[s.slug] ?? [];
      return {
        serviceSlug: s.slug,
        serviceName: s.name,
        published: this.coverage.servicePublished(s, clinics, codes, minClinics),
        cells: locations.map((l) => {
          const count = this.coverage.clinicsForCombo(clinics, l.slug, codes).length;
          const state =
            count === 0
              ? 'none'
              : count >= minClinics && l.status === 'available' && s.status === 'active'
                ? 'published'
                : 'below_threshold';
          return { citySlug: l.slug, count, state };
        }),
      };
    });

    return { minClinics, cities, matrix };
  }
}

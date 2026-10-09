import { Inject, Injectable } from '@nestjs/common';
import { CoverageService } from '../domain/coverage.service';
import {
  LOCALIZATION_REPOSITORY,
  type LocalizationRepositoryPort,
} from '../domain/ports/localization-repository.port';
import type { CityListDto } from '../domain/localization.dto';

@Injectable()
export class GetCitiesUseCase {
  constructor(
    @Inject(LOCALIZATION_REPOSITORY) private readonly repo: LocalizationRepositoryPort,
    private readonly coverage: CoverageService,
  ) {}

  async execute(): Promise<CityListDto> {
    const [raws, locations, minClinics] = await Promise.all([
      this.repo.loadActiveClinics(),
      this.repo.getLocations(false),
      this.repo.getMinClinics(),
    ]);
    const all = await this.repo.getLocations(true);
    const clinics = this.coverage.toClinicRecords(raws, all);
    return {
      cities: locations.map((l) => ({
        slug: l.slug,
        name: l.name,
        status: l.status,
        published: this.coverage.cityPublished(l, clinics, minClinics),
        clinicCount: this.coverage.localClinicsInCity(clinics, l.slug).length,
      })),
    };
  }
}

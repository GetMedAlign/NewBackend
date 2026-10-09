import { Inject, Injectable } from '@nestjs/common';
import { CoverageService } from '../domain/coverage.service';
import {
  LOCALIZATION_REPOSITORY,
  type LocalizationRepositoryPort,
} from '../domain/ports/localization-repository.port';
import type { ServiceListDto } from '../domain/localization.dto';

@Injectable()
export class GetServicesUseCase {
  constructor(
    @Inject(LOCALIZATION_REPOSITORY) private readonly repo: LocalizationRepositoryPort,
    private readonly coverage: CoverageService,
  ) {}

  async execute(): Promise<ServiceListDto> {
    const [raws, locations, services, codeMap, minClinics] = await Promise.all([
      this.repo.loadActiveClinics(),
      this.repo.getLocations(true),
      this.repo.getServices(false),
      this.repo.getServiceCodeMap(),
      this.repo.getMinClinics(),
    ]);
    const clinics = this.coverage.toClinicRecords(raws, locations);
    return {
      services: services.map((s) => {
        const codes = codeMap[s.slug] ?? [];
        const matching = this.coverage.clinicsForService(clinics, codes);
        const cityCount = new Set(matching.map((c) => c.city).filter(Boolean)).size;
        return {
          slug: s.slug,
          name: s.name,
          description: s.description,
          published: this.coverage.servicePublished(s, clinics, codes, minClinics),
          cityCount,
        };
      }),
    };
  }
}

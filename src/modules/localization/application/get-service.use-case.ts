import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CoverageService } from '../domain/coverage.service';
import {
  LOCALIZATION_REPOSITORY,
  type LocalizationRepositoryPort,
} from '../domain/ports/localization-repository.port';
import type { ServiceDetailDto, NamedCountDto } from '../domain/localization.dto';
import { toClinicDto } from './get-city.use-case';

@Injectable()
export class GetServiceUseCase {
  constructor(
    @Inject(LOCALIZATION_REPOSITORY) private readonly repo: LocalizationRepositoryPort,
    private readonly coverage: CoverageService,
  ) {}

  async execute(slug: string): Promise<ServiceDetailDto> {
    const service = await this.repo.getServiceBySlug(slug);
    if (!service) throw new NotFoundException(`No service '${slug}'`);

    const [raws, locations, services, codeMap, minClinics] = await Promise.all([
      this.repo.loadActiveClinics(),
      this.repo.getLocations(true),
      this.repo.getServices(false),
      this.repo.getServiceCodeMap(),
      this.repo.getMinClinics(),
    ]);
    const clinics = this.coverage.toClinicRecords(raws, locations);
    const codes = codeMap[service.slug] ?? [];
    const matching = this.coverage.clinicsForService(clinics, codes);
    const published = this.coverage.servicePublished(service, clinics, codes, minClinics);
    const nameBySlug = new Map(services.map((s) => [s.slug, s.name]));

    const cities: NamedCountDto[] = locations
      .filter((l) => l.status === 'available')
      .map((l) => ({
        slug: l.slug,
        name: l.name,
        count: matching.filter((c) => c.city === l.slug).length,
      }))
      .filter((x) => x.count > 0);

    const related: NamedCountDto[] = service.relatedSlugs
      .map((rs) => {
        const relCodes = codeMap[rs] ?? [];
        return {
          slug: rs,
          name: nameBySlug.get(rs) ?? rs,
          count: this.coverage.clinicsForService(clinics, relCodes).length,
        };
      })
      .filter((x) => nameBySlug.has(x.slug) && x.count >= minClinics);

    return {
      slug: service.slug,
      name: service.name,
      description: service.description,
      published,
      clinics: matching.map(toClinicDto),
      cities,
      relatedServices: related,
      meta: {
        path: `/services/${service.slug}/`,
        title: service.seoTitle,
        description: service.seoDescription,
        robots: published,
      },
    };
  }
}

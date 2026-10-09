import { NotFoundException } from '@nestjs/common';
import { GetCityUseCase } from '../get-city.use-case';
import { CoverageService } from '../../domain/coverage.service';
import type { LocalizationRepositoryPort } from '../../domain/ports/localization-repository.port';
import type { LocationRecord, RawClinicRecord, ServiceRecord } from '../../domain/coverage.types';

const TAMPA: LocationRecord = {
  slug: 'tampa',
  name: 'Tampa',
  stateCode: 'FL',
  status: 'available',
  area: 'South Tampa',
  intro: 'intro',
  aliases: [],
  nearSlugs: [],
  seoTitle: 'Specialized Clinics in Tampa, FL | MedAlign',
  seoDescription: 'desc',
  displayOrder: 0,
};

const CLEARWATER: LocationRecord = {
  slug: 'clearwater',
  name: 'Clearwater',
  stateCode: 'FL',
  status: 'available',
  area: '',
  intro: '',
  aliases: [],
  nearSlugs: [],
  seoTitle: '',
  seoDescription: '',
  displayOrder: 1,
};

const UNPUBLISHED_NEIGHBOR: LocationRecord = {
  slug: 'coming-soon-neighbor',
  name: 'Coming Soon Neighbor',
  stateCode: 'FL',
  status: 'coming_soon',
  area: '',
  intro: '',
  aliases: [],
  nearSlugs: [],
  seoTitle: '',
  seoDescription: '',
  displayOrder: 2,
};
const clinic = (id: string, city: string, services: string[]): RawClinicRecord => ({
  id,
  name: id,
  cityText: city,
  stateCode: 'FL',
  services,
  telehealth: false,
});

function makeRepo(over: Partial<LocalizationRepositoryPort> = {}): LocalizationRepositoryPort {
  return {
    loadActiveClinics: jest
      .fn()
      .mockResolvedValue([clinic('a', 'Tampa', ['trt']), clinic('b', 'Tampa', ['bhrt'])]),
    getLocations: jest.fn().mockResolvedValue([TAMPA]),
    getLocationBySlug: jest.fn().mockResolvedValue(TAMPA),
    getServices: jest.fn().mockResolvedValue([]),
    getServiceBySlug: jest.fn().mockResolvedValue(null),
    getServiceCodeMap: jest
      .fn()
      .mockResolvedValue({ 'hormone-optimization': ['trt', 'bhrt', 'menopause_hrt'] }),
    getMinClinics: jest.fn().mockResolvedValue(2),
    insertNotify: jest.fn().mockResolvedValue(undefined),
    ...over,
  };
}

describe('GetCityUseCase', () => {
  it('returns published city with meta.robots true when count >= min', async () => {
    const useCase = new GetCityUseCase(makeRepo(), new CoverageService());
    const result = await useCase.execute('tampa');
    expect(result.published).toBe(true);
    expect(result.meta.robots).toBe(true);
    expect(result.meta.path).toBe('/locations/tampa/');
    expect(result.clinics).toHaveLength(2);
  });

  it('returns published false + robots false when below threshold', async () => {
    const repo = makeRepo({
      loadActiveClinics: jest.fn().mockResolvedValue([clinic('a', 'Tampa', ['trt'])]),
    });
    const result = await new GetCityUseCase(repo, new CoverageService()).execute('tampa');
    expect(result.published).toBe(false);
    expect(result.meta.robots).toBe(false);
  });

  it('throws NotFound for a hidden/unknown city', async () => {
    const repo = makeRepo({ getLocationBySlug: jest.fn().mockResolvedValue(null) });
    await expect(
      new GetCityUseCase(repo, new CoverageService()).execute('nowhere'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('excludes an unpublished (not-yet-available) neighbor from nearbyCities', async () => {
    const TAMPA_WITH_NEAR: LocationRecord = {
      ...TAMPA,
      nearSlugs: ['clearwater', 'coming-soon-neighbor'],
    };
    const repo = makeRepo({
      getLocationBySlug: jest.fn().mockResolvedValue(TAMPA_WITH_NEAR),
      getLocations: jest
        .fn()
        .mockResolvedValue([TAMPA_WITH_NEAR, CLEARWATER, UNPUBLISHED_NEIGHBOR]),
      loadActiveClinics: jest
        .fn()
        .mockResolvedValue([
          clinic('a', 'Tampa', ['trt']),
          clinic('b', 'Tampa', ['bhrt']),
          clinic('c', 'Clearwater', ['trt']),
          clinic('d', 'Clearwater', ['bhrt']),
          clinic('e', 'Coming Soon Neighbor', ['trt']),
          clinic('f', 'Coming Soon Neighbor', ['bhrt']),
        ]),
    });
    const result = await new GetCityUseCase(repo, new CoverageService()).execute('tampa');

    expect(result.nearbyCities.some((n) => n.slug === 'clearwater')).toBe(true);
    expect(result.nearbyCities.some((n) => n.slug === 'coming-soon-neighbor')).toBe(false);
  });

  it('excludes a service with zero matching clinics from the services list', async () => {
    const ZERO_MATCH_SERVICE: ServiceRecord = {
      slug: 'zero-match-service',
      name: 'Zero Match Service',
      description: '',
      status: 'active',
      relatedSlugs: [],
      seoTitle: '',
      seoDescription: '',
      displayOrder: 0,
    };
    const repo = makeRepo({
      getServices: jest.fn().mockResolvedValue([ZERO_MATCH_SERVICE]),
      getServiceCodeMap: jest.fn().mockResolvedValue({ 'zero-match-service': ['no-such-code'] }),
    });
    const result = await new GetCityUseCase(repo, new CoverageService()).execute('tampa');

    expect(result.services.some((s) => s.slug === 'zero-match-service')).toBe(false);
  });
});

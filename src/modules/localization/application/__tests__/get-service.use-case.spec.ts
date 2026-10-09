import { GetServiceUseCase } from '../get-service.use-case';
import { CoverageService } from '../../domain/coverage.service';
import type { LocalizationRepositoryPort } from '../../domain/ports/localization-repository.port';
import type { LocationRecord, RawClinicRecord, ServiceRecord } from '../../domain/coverage.types';

const TAMPA: LocationRecord = {
  slug: 'tampa',
  name: 'Tampa',
  stateCode: 'FL',
  status: 'available',
  area: '',
  intro: '',
  aliases: [],
  nearSlugs: [],
  seoTitle: '',
  seoDescription: '',
  displayOrder: 0,
};

const HORMONE: ServiceRecord = {
  slug: 'hormone-optimization',
  name: 'Hormone Optimization',
  description: '',
  status: 'active',
  relatedSlugs: ['longevity-anti-aging', 'hidden-service', 'below-threshold-service'],
  seoTitle: '',
  seoDescription: '',
  displayOrder: 0,
};

const LONGEVITY: ServiceRecord = {
  slug: 'longevity-anti-aging',
  name: 'Longevity & Anti-Aging',
  description: '',
  status: 'active',
  relatedSlugs: [],
  seoTitle: '',
  seoDescription: '',
  displayOrder: 1,
};

const BELOW_THRESHOLD: ServiceRecord = {
  slug: 'below-threshold-service',
  name: 'Below Threshold Service',
  description: '',
  status: 'active',
  relatedSlugs: [],
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
      .mockResolvedValue([
        clinic('a', 'Tampa', ['trt']),
        clinic('b', 'Tampa', ['bhrt']),
        clinic('c', 'Tampa', ['peptide']),
        clinic('d', 'Tampa', ['peptide']),
        clinic('e', 'Tampa', ['rare-code']),
      ]),
    getLocations: jest.fn().mockResolvedValue([TAMPA]),
    getLocationBySlug: jest.fn().mockResolvedValue(TAMPA),
    // getServices(false) excludes hidden services, so 'hidden-service' is absent here.
    getServices: jest.fn().mockResolvedValue([LONGEVITY, BELOW_THRESHOLD]),
    getServiceBySlug: jest.fn().mockResolvedValue(HORMONE),
    getServiceCodeMap: jest.fn().mockResolvedValue({
      'hormone-optimization': ['trt', 'bhrt'],
      'longevity-anti-aging': ['peptide'],
      'below-threshold-service': ['rare-code'],
      'hidden-service': ['rare-code'],
    }),
    getMinClinics: jest.fn().mockResolvedValue(2),
    insertNotify: jest.fn().mockResolvedValue(undefined),
    ...over,
  };
}

describe('GetServiceUseCase', () => {
  it('resolves related-service display names instead of echoing the slug', async () => {
    const useCase = new GetServiceUseCase(makeRepo(), new CoverageService());
    const result = await useCase.execute('hormone-optimization');

    const longevity = result.relatedServices.find((r) => r.slug === 'longevity-anti-aging');
    expect(longevity).toBeDefined();
    expect(longevity?.name).toBe('Longevity & Anti-Aging');
    expect(longevity?.name).not.toBe('longevity-anti-aging');
  });

  it('excludes a related service that is hidden even if it meets the clinic threshold', async () => {
    const useCase = new GetServiceUseCase(makeRepo(), new CoverageService());
    const result = await useCase.execute('hormone-optimization');

    expect(result.relatedServices.some((r) => r.slug === 'hidden-service')).toBe(false);
  });

  it('excludes a related service that is below the clinic threshold', async () => {
    const useCase = new GetServiceUseCase(makeRepo(), new CoverageService());
    const result = await useCase.execute('hormone-optimization');

    expect(result.relatedServices.some((r) => r.slug === 'below-threshold-service')).toBe(false);
  });
});

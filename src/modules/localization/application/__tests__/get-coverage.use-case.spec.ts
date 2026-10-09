import { GetCoverageUseCase } from '../get-coverage.use-case';
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

const ORLANDO: LocationRecord = {
  slug: 'orlando',
  name: 'Orlando',
  stateCode: 'FL',
  status: 'coming_soon',
  area: '',
  intro: '',
  aliases: [],
  nearSlugs: [],
  seoTitle: '',
  seoDescription: '',
  displayOrder: 1,
};

const HORMONE: ServiceRecord = {
  slug: 'hormone-optimization',
  name: 'Hormone Optimization',
  description: '',
  status: 'active',
  relatedSlugs: [],
  seoTitle: '',
  seoDescription: '',
  displayOrder: 0,
};

const LOWCOUNT: ServiceRecord = {
  slug: 'lowcount-service',
  name: 'Lowcount Service',
  description: '',
  status: 'active',
  relatedSlugs: [],
  seoTitle: '',
  seoDescription: '',
  displayOrder: 1,
};

const HIDDEN_WITH_CLINICS: ServiceRecord = {
  slug: 'hidden-with-clinics',
  name: 'Hidden With Clinics',
  description: '',
  status: 'hidden',
  relatedSlugs: [],
  seoTitle: '',
  seoDescription: '',
  displayOrder: 2,
};

const HIDDEN_NONE: ServiceRecord = {
  slug: 'hidden-none',
  name: 'Hidden None',
  description: '',
  status: 'hidden',
  relatedSlugs: [],
  seoTitle: '',
  seoDescription: '',
  displayOrder: 3,
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
        clinic('c', 'Orlando', ['trt']),
        clinic('d', 'Orlando', ['bhrt']),
        clinic('e', 'Tampa', ['ycode']),
        clinic('f', 'Tampa', ['zcode']),
        clinic('g', 'Tampa', ['zcode']),
      ]),
    getLocations: jest.fn().mockResolvedValue([TAMPA, ORLANDO]),
    getLocationBySlug: jest.fn(),
    getServiceBySlug: jest.fn(),
    getServices: jest.fn().mockResolvedValue([HORMONE, LOWCOUNT, HIDDEN_WITH_CLINICS, HIDDEN_NONE]),
    getServiceCodeMap: jest.fn().mockResolvedValue({
      'hormone-optimization': ['trt', 'bhrt'],
      'lowcount-service': ['ycode'],
      'hidden-with-clinics': ['zcode'],
      'hidden-none': ['xcode'],
    }),
    getMinClinics: jest.fn().mockResolvedValue(2),
    insertNotify: jest.fn(),
    ...over,
  };
}

function cellFor(
  result: Awaited<ReturnType<GetCoverageUseCase['execute']>>,
  serviceSlug: string,
  citySlug: string,
) {
  const row = result.matrix.find((r) => r.serviceSlug === serviceSlug);
  return row?.cells.find((c) => c.citySlug === citySlug);
}

describe('GetCoverageUseCase', () => {
  it('builds a matrix cell marked published when count >= min', async () => {
    const repo = makeRepo();
    const result = await new GetCoverageUseCase(repo, new CoverageService()).execute();
    expect(result.minClinics).toBe(2);
    const cell = cellFor(result, 'hormone-optimization', 'tampa');
    expect(cell?.count).toBe(2);
    expect(cell?.state).toBe('published');
  });

  it('marks a cell "none" when zero clinics match the service codes', async () => {
    const repo = makeRepo();
    const result = await new GetCoverageUseCase(repo, new CoverageService()).execute();
    const cell = cellFor(result, 'hidden-none', 'tampa');
    expect(cell?.count).toBe(0);
    expect(cell?.state).toBe('none');
  });

  it('marks a cell "below_threshold" when the count is below minClinics', async () => {
    const repo = makeRepo();
    const result = await new GetCoverageUseCase(repo, new CoverageService()).execute();
    const cell = cellFor(result, 'lowcount-service', 'tampa');
    expect(cell?.count).toBe(1);
    expect(cell?.state).toBe('below_threshold');
  });

  it('marks a cell "below_threshold" when count >= min but the city is not available', async () => {
    const repo = makeRepo();
    const result = await new GetCoverageUseCase(repo, new CoverageService()).execute();
    const cell = cellFor(result, 'hormone-optimization', 'orlando');
    expect(cell?.count).toBe(2);
    expect(cell?.state).toBe('below_threshold');
  });

  it('marks a cell "below_threshold" when count >= min but the service is not active', async () => {
    const repo = makeRepo();
    const result = await new GetCoverageUseCase(repo, new CoverageService()).execute();
    const cell = cellFor(result, 'hidden-with-clinics', 'tampa');
    expect(cell?.count).toBe(2);
    expect(cell?.state).toBe('below_threshold');
  });
});

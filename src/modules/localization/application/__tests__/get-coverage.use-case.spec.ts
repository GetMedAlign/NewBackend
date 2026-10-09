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
const clinic = (id: string, city: string, services: string[]): RawClinicRecord => ({
  id,
  name: id,
  cityText: city,
  stateCode: 'FL',
  services,
  telehealth: false,
});

describe('GetCoverageUseCase', () => {
  it('builds a matrix cell marked published when count >= min', async () => {
    const repo: LocalizationRepositoryPort = {
      loadActiveClinics: jest
        .fn()
        .mockResolvedValue([clinic('a', 'Tampa', ['trt']), clinic('b', 'Tampa', ['bhrt'])]),
      getLocations: jest.fn().mockResolvedValue([TAMPA]),
      getLocationBySlug: jest.fn(),
      getServiceBySlug: jest.fn(),
      getServices: jest.fn().mockResolvedValue([HORMONE]),
      getServiceCodeMap: jest.fn().mockResolvedValue({ 'hormone-optimization': ['trt', 'bhrt'] }),
      getMinClinics: jest.fn().mockResolvedValue(2),
      insertNotify: jest.fn(),
    };
    const result = await new GetCoverageUseCase(repo, new CoverageService()).execute();
    expect(result.minClinics).toBe(2);
    const cell = result.matrix[0].cells.find((c) => c.citySlug === 'tampa');
    expect(cell?.count).toBe(2);
    expect(cell?.state).toBe('published');
  });
});

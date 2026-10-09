import { GetComboUseCase } from '../get-combo.use-case';
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
  nearSlugs: ['coming-soon-neighbor'],
  seoTitle: '',
  seoDescription: '',
  displayOrder: 0,
};

const COMING_SOON_NEIGHBOR: LocationRecord = {
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
        clinic('b', 'Coming Soon Neighbor', ['trt']),
        clinic('c', 'Coming Soon Neighbor', ['bhrt']),
      ]),
    getLocations: jest.fn().mockResolvedValue([TAMPA, COMING_SOON_NEIGHBOR]),
    getLocationBySlug: jest.fn().mockResolvedValue(TAMPA),
    getServices: jest.fn().mockResolvedValue([HORMONE]),
    getServiceBySlug: jest.fn().mockResolvedValue(HORMONE),
    getServiceCodeMap: jest.fn().mockResolvedValue({ 'hormone-optimization': ['trt', 'bhrt'] }),
    getMinClinics: jest.fn().mockResolvedValue(2),
    insertNotify: jest.fn().mockResolvedValue(undefined),
    ...over,
  };
}

describe('GetComboUseCase', () => {
  it('does not surface nearbyClinics from a neighbor city that is not available', async () => {
    const repo = makeRepo();
    const result = await new GetComboUseCase(repo, new CoverageService()).execute(
      'tampa',
      'hormone-optimization',
    );

    // Local Tampa has only 1 matching clinic (< 3), so nearby lookup would normally kick in.
    expect(result.clinics).toHaveLength(1);
    // The neighbor has 2 matching clinics, but it is 'coming_soon' (not available), so it
    // must contribute none of them.
    expect(result.nearbyClinics).toHaveLength(0);
  });

  it('still surfaces nearbyClinics from an available neighbor', async () => {
    const AVAILABLE_NEIGHBOR: LocationRecord = { ...COMING_SOON_NEIGHBOR, status: 'available' };
    const repo = makeRepo({
      getLocations: jest.fn().mockResolvedValue([TAMPA, AVAILABLE_NEIGHBOR]),
    });
    const result = await new GetComboUseCase(repo, new CoverageService()).execute(
      'tampa',
      'hormone-optimization',
    );

    expect(result.nearbyClinics.length).toBeGreaterThan(0);
  });
});

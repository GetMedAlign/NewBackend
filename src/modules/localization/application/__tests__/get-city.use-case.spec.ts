import { NotFoundException } from '@nestjs/common';
import { GetCityUseCase } from '../get-city.use-case';
import { CoverageService } from '../../domain/coverage.service';
import type { LocalizationRepositoryPort } from '../../domain/ports/localization-repository.port';
import type { LocationRecord, RawClinicRecord } from '../../domain/coverage.types';

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
});

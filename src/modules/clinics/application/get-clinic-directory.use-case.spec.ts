import { GetClinicDirectoryUseCase } from './get-clinic-directory.use-case';
import type { ClinicRepositoryPort } from '../domain/ports/clinic-repository.port';
import type { ZipGeocoder } from '../../../infrastructure/geo/zip-geocoder';

function makeRepo(overrides: Partial<ClinicRepositoryPort> = {}): ClinicRepositoryPort {
  return {
    findMatchable: jest.fn(),
    findById: jest.fn(),
    findBySlug: jest.fn(),
    findDirectory: jest.fn().mockResolvedValue({ items: [], totalCount: 0 }),
    findProfileBySlug: jest.fn(),
    ...overrides,
  };
}

function makeZipGeocoder(overrides: Partial<ZipGeocoder> = {}): ZipGeocoder {
  return {
    lookup: jest.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as ZipGeocoder;
}

describe('GetClinicDirectoryUseCase', () => {
  it('passes a trimmed city filter to the repository', async () => {
    const repo = makeRepo();
    const useCase = new GetClinicDirectoryUseCase(repo, makeZipGeocoder());

    await useCase.execute({ city: '  Tampa  ' });

    expect(repo.findDirectory).toHaveBeenCalledWith(expect.objectContaining({ city: 'Tampa' }));
  });

  it('omits the city filter when not provided', async () => {
    const repo = makeRepo();
    const useCase = new GetClinicDirectoryUseCase(repo, makeZipGeocoder());

    await useCase.execute({});

    expect(repo.findDirectory).toHaveBeenCalledWith(expect.objectContaining({ city: undefined }));
  });
});

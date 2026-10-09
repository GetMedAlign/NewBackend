import { BadRequestException } from '@nestjs/common';
import { CaptureNotifyUseCase } from '../capture-notify.use-case';
import type { LocalizationRepositoryPort } from '../../domain/ports/localization-repository.port';

function makeRepo(): LocalizationRepositoryPort {
  return {
    loadActiveClinics: jest.fn(),
    getLocations: jest.fn(),
    getLocationBySlug: jest.fn(),
    getServices: jest.fn(),
    getServiceBySlug: jest.fn(),
    getServiceCodeMap: jest.fn(),
    getMinClinics: jest.fn(),
    insertNotify: jest.fn().mockResolvedValue(undefined),
  };
}

describe('CaptureNotifyUseCase', () => {
  it('rejects an invalid email', async () => {
    await expect(
      new CaptureNotifyUseCase(makeRepo()).execute({ email: 'nope', citySlug: null }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stores a valid email and returns ok', async () => {
    const repo = makeRepo();
    const result = await new CaptureNotifyUseCase(repo).execute({
      email: 'a@b.com',
      citySlug: 'orlando',
    });
    expect(result).toEqual({ ok: true });
    expect(repo.insertNotify).toHaveBeenCalledWith('a@b.com', 'orlando');
  });
});

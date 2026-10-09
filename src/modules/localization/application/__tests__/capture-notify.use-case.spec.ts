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

  it('rejects an email longer than 320 characters', async () => {
    const localPart = 'a'.repeat(315);
    const tooLongEmail = `${localPart}@b.com`; // > 320 chars total
    expect(tooLongEmail.length).toBeGreaterThan(320);

    await expect(
      new CaptureNotifyUseCase(makeRepo()).execute({ email: tooLongEmail, citySlug: null }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('normalizes a mixed-case/whitespace email before storing it', async () => {
    const repo = makeRepo();
    const result = await new CaptureNotifyUseCase(repo).execute({
      email: '  A@B.CoM  ',
      citySlug: 'orlando',
    });
    expect(result).toEqual({ ok: true });
    expect(repo.insertNotify).toHaveBeenCalledWith('a@b.com', 'orlando');
  });
});

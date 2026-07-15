import { BadRequestException } from '@nestjs/common';
import { UpdateClinicProfileUseCase } from '../update-clinic-profile.use-case';
import type {
  ClinicWriteRepositoryPort,
  UpdateClinicProfilePatch,
} from '../../domain/ports/clinic-write-repository.port';

const CLINIC_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function makeRepo(): ClinicWriteRepositoryPort {
  return {
    findProfile: jest.fn(),
    updateProfile: jest.fn().mockResolvedValue(undefined),
  };
}

describe('UpdateClinicProfileUseCase', () => {
  it('calls repo.updateProfile with the patch when no webhookUrl provided', async () => {
    const repo = makeRepo();
    const useCase = new UpdateClinicProfileUseCase(repo);
    const patch: UpdateClinicProfilePatch = { name: 'New Name', offersLabWork: true };

    await useCase.execute(CLINIC_ID, patch);

    expect(repo.updateProfile).toHaveBeenCalledWith(CLINIC_ID, patch);
  });

  it('accepts a valid HTTPS webhookUrl', async () => {
    const repo = makeRepo();
    const useCase = new UpdateClinicProfileUseCase(repo);
    const patch: UpdateClinicProfilePatch = { webhookUrl: 'https://example.com/hook' };

    await useCase.execute(CLINIC_ID, patch);

    expect(repo.updateProfile).toHaveBeenCalledWith(CLINIC_ID, patch);
  });

  it('rejects a non-HTTPS webhookUrl', async () => {
    const repo = makeRepo();
    const useCase = new UpdateClinicProfileUseCase(repo);

    await expect(
      useCase.execute(CLINIC_ID, { webhookUrl: 'http://example.com/hook' }),
    ).rejects.toThrow(BadRequestException);
    expect(repo.updateProfile).not.toHaveBeenCalled();
  });

  it('rejects a malformed webhookUrl', async () => {
    const repo = makeRepo();
    const useCase = new UpdateClinicProfileUseCase(repo);

    await expect(useCase.execute(CLINIC_ID, { webhookUrl: 'not-a-url' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('allows webhookUrl: null to clear the webhook', async () => {
    const repo = makeRepo();
    const useCase = new UpdateClinicProfileUseCase(repo);
    const patch: UpdateClinicProfilePatch = { webhookUrl: null };

    await useCase.execute(CLINIC_ID, patch);

    expect(repo.updateProfile).toHaveBeenCalledWith(CLINIC_ID, patch);
  });

  it('does not validate webhookUrl when it is undefined', async () => {
    const repo = makeRepo();
    const useCase = new UpdateClinicProfileUseCase(repo);

    await useCase.execute(CLINIC_ID, {});

    expect(repo.updateProfile).toHaveBeenCalledWith(CLINIC_ID, {});
  });
});

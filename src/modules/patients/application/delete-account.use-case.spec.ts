import { NotFoundException } from '@nestjs/common';
import { DeleteAccountUseCase } from './delete-account.use-case';
import type { PatientRepositoryPort } from '../domain/ports/patient-repository.port';

const makeRepo = (): jest.Mocked<PatientRepositoryPort> => ({
  findProfile: jest.fn(),
  updateProfile: jest.fn(),
  findPatientIdByUserId: jest.fn(),
  softDeleteSelf: jest.fn(),
});

describe('DeleteAccountUseCase', () => {
  it('returns success when the account is soft-deleted', async () => {
    const repo = makeRepo();
    repo.softDeleteSelf.mockResolvedValue('ok');
    const useCase = new DeleteAccountUseCase(repo);

    await expect(useCase.execute('user-1')).resolves.toEqual({ success: true });
    expect(repo.softDeleteSelf).toHaveBeenCalledWith('user-1');
  });

  it('is idempotent when already deleted', async () => {
    const repo = makeRepo();
    repo.softDeleteSelf.mockResolvedValue('already_deleted');
    const useCase = new DeleteAccountUseCase(repo);

    await expect(useCase.execute('user-1')).resolves.toEqual({ success: true });
  });

  it('throws 404 when there is no patient account', async () => {
    const repo = makeRepo();
    repo.softDeleteSelf.mockResolvedValue('not_found');
    const useCase = new DeleteAccountUseCase(repo);

    await expect(useCase.execute('user-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

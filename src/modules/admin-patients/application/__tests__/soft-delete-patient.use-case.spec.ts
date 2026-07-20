import { ConflictException, NotFoundException } from '@nestjs/common';
import { SoftDeletePatientUseCase } from '../soft-delete-patient.use-case';

describe('SoftDeletePatientUseCase', () => {
  const repo = {
    listPatients: jest.fn(),
    getPatient: jest.fn(),
    updatePatient: jest.fn(),
    softDeletePatient: jest.fn(),
  };
  const useCase = new SoftDeletePatientUseCase(repo);
  const ctx = { userId: 'admin-1', role: 'admin', ip: '127.0.0.1' };

  beforeEach(() => jest.resetAllMocks());

  it('throws NotFoundException when the repository reports not_found', async () => {
    repo.softDeletePatient.mockResolvedValue('not_found');
    await expect(useCase.execute(ctx, 'missing')).rejects.toThrow(NotFoundException);
    await expect(useCase.execute(ctx, 'missing')).rejects.toThrow('Patient not found.');
  });

  it('throws ConflictException when the repository reports already_deleted', async () => {
    repo.softDeletePatient.mockResolvedValue('already_deleted');
    await expect(useCase.execute(ctx, 'p1')).rejects.toThrow(ConflictException);
  });

  it('returns { success: true } when the repository reports ok', async () => {
    repo.softDeletePatient.mockResolvedValue('ok');
    await expect(useCase.execute(ctx, 'p1')).resolves.toEqual({ success: true });
    expect(repo.softDeletePatient).toHaveBeenCalledWith(ctx, 'p1');
  });
});

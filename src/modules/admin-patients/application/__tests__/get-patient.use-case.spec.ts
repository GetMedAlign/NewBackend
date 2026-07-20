import { NotFoundException } from '@nestjs/common';
import { GetPatientUseCase } from '../get-patient.use-case';

describe('GetPatientUseCase', () => {
  const repo = {
    listPatients: jest.fn(),
    getPatient: jest.fn(),
    updatePatient: jest.fn(),
    softDeletePatient: jest.fn(),
    findPatientUser: jest.fn(),
  };
  const useCase = new GetPatientUseCase(repo);
  const ctx = { userId: 'u1', role: 'admin', ip: '127.0.0.1' };

  beforeEach(() => jest.resetAllMocks());

  it('returns the patient the repository resolves', async () => {
    const dto = { id: 'p1' };
    repo.getPatient.mockResolvedValue(dto);
    await expect(useCase.execute(ctx, 'p1')).resolves.toBe(dto);
    expect(repo.getPatient).toHaveBeenCalledWith(ctx, 'p1');
  });

  it('throws NotFoundException when the patient does not exist', async () => {
    repo.getPatient.mockResolvedValue(null);
    await expect(useCase.execute(ctx, 'missing')).rejects.toThrow(NotFoundException);
    await expect(useCase.execute(ctx, 'missing')).rejects.toThrow('Patient not found.');
  });
});

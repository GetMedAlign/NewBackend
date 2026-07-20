import { NotFoundException } from '@nestjs/common';
import { GetClinicUseCase } from '../get-clinic.use-case';

describe('GetClinicUseCase', () => {
  const repo = {
    listClinics: jest.fn(),
    getClinic: jest.fn(),
    updateClinic: jest.fn(),
    pauseDelivery: jest.fn(),
    clinicExists: jest.fn(),
    listClinicLeads: jest.fn(),
  };
  const useCase = new GetClinicUseCase(repo);
  const ctx = { userId: 'u1', role: 'admin', ip: '127.0.0.1' };

  beforeEach(() => jest.resetAllMocks());

  it('returns the clinic the repository resolves', async () => {
    const dto = { id: 'c1' };
    repo.getClinic.mockResolvedValue(dto);
    await expect(useCase.execute(ctx, 'c1')).resolves.toBe(dto);
    expect(repo.getClinic).toHaveBeenCalledWith(ctx, 'c1');
  });

  it('throws NotFoundException when the clinic does not exist', async () => {
    repo.getClinic.mockResolvedValue(null);
    await expect(useCase.execute(ctx, 'missing')).rejects.toThrow(NotFoundException);
    await expect(useCase.execute(ctx, 'missing')).rejects.toThrow('Clinic not found.');
  });
});

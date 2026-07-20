import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { UpdateClinicUseCase } from '../update-clinic.use-case';
import { ADMIN_CLINIC_REPOSITORY } from '../../domain/ports/admin-clinic-repository.port';
import type { AdminClinicRepositoryPort } from '../../domain/ports/admin-clinic-repository.port';

const ctx = { userId: 'admin-1', role: 'admin', ip: '127.0.0.1' };

describe('UpdateClinicUseCase', () => {
  let useCase: UpdateClinicUseCase;
  let repo: jest.Mocked<AdminClinicRepositoryPort>;

  beforeEach(async () => {
    repo = {
      listClinics: jest.fn(),
      getClinic: jest.fn(),
      updateClinic: jest.fn(),
      pauseDelivery: jest.fn(),
      clinicExists: jest.fn(),
      listClinicLeads: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [UpdateClinicUseCase, { provide: ADMIN_CLINIC_REPOSITORY, useValue: repo }],
    }).compile();

    useCase = module.get(UpdateClinicUseCase);
  });

  it('throws NotFoundException when the repository reports the clinic is missing', async () => {
    repo.updateClinic.mockResolvedValue(false);
    await expect(useCase.execute(ctx, 'missing', { name: 'X' })).rejects.toThrow(NotFoundException);
  });

  it('forwards only the fields present in the input', async () => {
    repo.updateClinic.mockResolvedValue(true);
    await useCase.execute(ctx, 'c1', { name: 'X', city: 'Austin' });
    expect(repo.updateClinic).toHaveBeenCalledWith(ctx, 'c1', { name: 'X', city: 'Austin' });
  });

  it('drops an unrecognized status instead of rejecting the request', async () => {
    repo.updateClinic.mockResolvedValue(true);
    await useCase.execute(ctx, 'c1', { name: 'X', status: 'bogus' });
    expect(repo.updateClinic).toHaveBeenCalledWith(ctx, 'c1', { name: 'X' });
  });

  it.each(['active', 'paused', 'suspended', 'inactive'])(
    'keeps the valid status %s',
    async (status) => {
      repo.updateClinic.mockResolvedValue(true);
      await useCase.execute(ctx, 'c1', { status });
      expect(repo.updateClinic).toHaveBeenCalledWith(ctx, 'c1', { status });
    },
  );

  it('drops null fields, leaving them out of the forwarded input', async () => {
    repo.updateClinic.mockResolvedValue(true);
    await useCase.execute(ctx, 'c1', { name: 'X', about: null as unknown as undefined });
    expect(repo.updateClinic).toHaveBeenCalledWith(ctx, 'c1', { name: 'X' });
  });
});

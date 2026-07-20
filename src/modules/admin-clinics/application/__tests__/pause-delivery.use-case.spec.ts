import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PauseDeliveryUseCase } from '../pause-delivery.use-case';
import { ADMIN_CLINIC_REPOSITORY } from '../../domain/ports/admin-clinic-repository.port';
import type { AdminClinicRepositoryPort } from '../../domain/ports/admin-clinic-repository.port';

const ctx = { userId: 'admin-1', role: 'admin', ip: '127.0.0.1' };

describe('PauseDeliveryUseCase', () => {
  let useCase: PauseDeliveryUseCase;
  let repo: jest.Mocked<AdminClinicRepositoryPort>;

  beforeEach(async () => {
    repo = {
      listClinics: jest.fn(),
      getClinic: jest.fn(),
      updateClinic: jest.fn(),
      pauseDelivery: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [PauseDeliveryUseCase, { provide: ADMIN_CLINIC_REPOSITORY, useValue: repo }],
    }).compile();

    useCase = module.get(PauseDeliveryUseCase);
  });

  it('throws NotFoundException when the repository reports the clinic is missing', async () => {
    repo.pauseDelivery.mockResolvedValue(false);
    await expect(useCase.execute(ctx, 'missing', true)).rejects.toThrow(NotFoundException);
  });

  it('forwards paused=true verbatim', async () => {
    repo.pauseDelivery.mockResolvedValue(true);
    await useCase.execute(ctx, 'c1', true);
    expect(repo.pauseDelivery).toHaveBeenCalledWith(ctx, 'c1', true);
  });

  it('forwards paused=false verbatim', async () => {
    repo.pauseDelivery.mockResolvedValue(true);
    await useCase.execute(ctx, 'c1', false);
    expect(repo.pauseDelivery).toHaveBeenCalledWith(ctx, 'c1', false);
  });
});

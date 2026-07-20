import { ConflictException, NotFoundException } from '@nestjs/common';
import { UpdatePatientUseCase } from '../update-patient.use-case';

describe('UpdatePatientUseCase', () => {
  const repo = {
    listPatients: jest.fn(),
    getPatient: jest.fn(),
    updatePatient: jest.fn(),
    softDeletePatient: jest.fn(),
    findPatientUser: jest.fn(),
  };
  const useCase = new UpdatePatientUseCase(repo);
  const ctx = { userId: 'admin-1', role: 'admin', ip: '127.0.0.1' };

  beforeEach(() => jest.resetAllMocks());

  it('throws NotFoundException when the repository reports not_found', async () => {
    repo.updatePatient.mockResolvedValue('not_found');
    await expect(useCase.execute(ctx, 'missing', { name: 'Alex' })).rejects.toThrow(
      NotFoundException,
    );
    await expect(useCase.execute(ctx, 'missing', { name: 'Alex' })).rejects.toThrow(
      'Patient not found.',
    );
  });

  it('throws ConflictException when the repository reports already_deleted', async () => {
    repo.updatePatient.mockResolvedValue('already_deleted');
    await expect(useCase.execute(ctx, 'p1', { name: 'Alex' })).rejects.toThrow(ConflictException);
  });

  it('returns { success: true } when the repository reports ok', async () => {
    repo.updatePatient.mockResolvedValue('ok');
    await expect(useCase.execute(ctx, 'p1', { name: 'Alex' })).resolves.toEqual({ success: true });
  });

  it('drops an unparseable dob instead of rejecting the request', async () => {
    repo.updatePatient.mockResolvedValue('ok');
    await useCase.execute(ctx, 'p1', { name: 'Alex', dob: 'not-a-date' });
    expect(repo.updatePatient).toHaveBeenCalledWith(ctx, 'p1', { name: 'Alex' });
  });

  it('keeps a valid dob', async () => {
    repo.updatePatient.mockResolvedValue('ok');
    await useCase.execute(ctx, 'p1', { dob: '1985-04-12' });
    expect(repo.updatePatient).toHaveBeenCalledWith(ctx, 'p1', { dob: '1985-04-12' });
  });

  it('drops a rolled-over calendar date like 2020-02-30 instead of rejecting the request', async () => {
    repo.updatePatient.mockResolvedValue('ok');
    await useCase.execute(ctx, 'p1', { name: 'Alex', dob: '2020-02-30' });
    expect(repo.updatePatient).toHaveBeenCalledWith(ctx, 'p1', { name: 'Alex' });
  });

  it('drops a bare year like 2020 instead of rejecting the request', async () => {
    repo.updatePatient.mockResolvedValue('ok');
    await useCase.execute(ctx, 'p1', { name: 'Alex', dob: '2020' });
    expect(repo.updatePatient).toHaveBeenCalledWith(ctx, 'p1', { name: 'Alex' });
  });

  it('drops null fields, leaving them out of the forwarded input', async () => {
    repo.updatePatient.mockResolvedValue('ok');
    await useCase.execute(ctx, 'p1', { name: null as unknown as undefined, zipCode: '90210' });
    expect(repo.updatePatient).toHaveBeenCalledWith(ctx, 'p1', { zipCode: '90210' });
  });
});

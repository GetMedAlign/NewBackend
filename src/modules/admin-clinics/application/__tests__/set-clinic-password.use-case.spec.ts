import { NotFoundException } from '@nestjs/common';
import { SetClinicPasswordUseCase } from '../set-clinic-password.use-case';
import type { AdminClinicRepositoryPort } from '../../domain/ports/admin-clinic-repository.port';
import type { PasswordResetRepositoryPort } from '../../../auth/domain/ports/password-reset-repository.port';
import type { PasswordHasherPort } from '../../../auth/domain/ports/password-hasher.port';
import type { AuditPort } from '../../../auth/domain/ports/audit.port';

const ctx = { userId: 'admin-1', role: 'admin', ip: '127.0.0.1' };

const makeRepo = (): jest.Mocked<AdminClinicRepositoryPort> => ({
  listClinics: jest.fn(),
  getClinic: jest.fn(),
  updateClinic: jest.fn(),
  pauseDelivery: jest.fn(),
  clinicExists: jest.fn(),
  listClinicLeads: jest.fn(),
  findClinicUser: jest.fn(),
});

const makeResetRepo = (): jest.Mocked<PasswordResetRepositoryPort> => ({
  findUserIdByEmail: jest.fn(),
  issue: jest.fn(),
  findValidByEmail: jest.fn(),
  consume: jest.fn(),
  updatePasswordHash: jest.fn().mockResolvedValue(undefined),
});

const makeHasher = (): jest.Mocked<PasswordHasherPort> => ({
  hash: jest.fn().mockResolvedValue('hashed'),
  verify: jest.fn(),
});

const makeAudit = (): jest.Mocked<AuditPort> => ({
  record: jest.fn().mockResolvedValue(undefined),
});

describe('SetClinicPasswordUseCase', () => {
  let useCase: SetClinicPasswordUseCase;
  let repo: jest.Mocked<AdminClinicRepositoryPort>;
  let resetRepo: jest.Mocked<PasswordResetRepositoryPort>;
  let hasher: jest.Mocked<PasswordHasherPort>;
  let audit: jest.Mocked<AuditPort>;

  beforeEach(() => {
    repo = makeRepo();
    resetRepo = makeResetRepo();
    hasher = makeHasher();
    audit = makeAudit();
    useCase = new SetClinicPasswordUseCase(repo, resetRepo, hasher, audit);
  });

  it('hashes the new password and stores the hash', async () => {
    repo.findClinicUser.mockResolvedValue({ userId: 'u9', email: 'c@example.com' });
    hasher.hash.mockResolvedValue('argon2-hash');
    await useCase.execute(ctx, 'c1', 'NewPassw0rd!');
    expect(hasher.hash).toHaveBeenCalledWith('NewPassw0rd!');
    expect(resetRepo.updatePasswordHash).toHaveBeenCalledWith('u9', 'argon2-hash');
  });

  it('writes an audit entry naming the acting admin', async () => {
    repo.findClinicUser.mockResolvedValue({ userId: 'u9', email: 'c@example.com' });
    await useCase.execute(ctx, 'c1', 'NewPassw0rd!');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: ctx.userId,
        actorRole: ctx.role,
        actionType: 'admin_set_password',
        affectedRecord: 'u9',
      }),
    );
  });

  it('throws NotFoundException when the clinic has no linked user', async () => {
    repo.findClinicUser.mockResolvedValue(null);
    await expect(useCase.execute(ctx, 'c1', 'NewPassw0rd!')).rejects.toThrow(
      'No user account found for this clinic.',
    );
    await expect(useCase.execute(ctx, 'c1', 'NewPassw0rd!')).rejects.toThrow(NotFoundException);
    expect(resetRepo.updatePasswordHash).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('returns { success: true }', async () => {
    repo.findClinicUser.mockResolvedValue({ userId: 'u9', email: 'c@example.com' });
    await expect(useCase.execute(ctx, 'c1', 'NewPassw0rd!')).resolves.toEqual({ success: true });
  });
});

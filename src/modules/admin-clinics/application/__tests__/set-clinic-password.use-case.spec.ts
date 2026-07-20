import { NotFoundException } from '@nestjs/common';
import { SetClinicPasswordUseCase } from '../set-clinic-password.use-case';
import type { AdminClinicRepositoryPort } from '../../domain/ports/admin-clinic-repository.port';
import type { AdminSetPasswordPort } from '../../../auth/domain/ports/admin-set-password.port';
import type { PasswordHasherPort } from '../../../auth/domain/ports/password-hasher.port';

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

const makeAdminSetPassword = (): jest.Mocked<AdminSetPasswordPort> => ({
  setPasswordWithAudit: jest.fn().mockResolvedValue(undefined),
});

const makeHasher = (): jest.Mocked<PasswordHasherPort> => ({
  hash: jest.fn().mockResolvedValue('hashed'),
  verify: jest.fn(),
});

describe('SetClinicPasswordUseCase', () => {
  let useCase: SetClinicPasswordUseCase;
  let repo: jest.Mocked<AdminClinicRepositoryPort>;
  let adminSetPassword: jest.Mocked<AdminSetPasswordPort>;
  let hasher: jest.Mocked<PasswordHasherPort>;

  beforeEach(() => {
    repo = makeRepo();
    adminSetPassword = makeAdminSetPassword();
    hasher = makeHasher();
    useCase = new SetClinicPasswordUseCase(repo, adminSetPassword, hasher);
  });

  it('hashes the new password and stores the hash', async () => {
    repo.findClinicUser.mockResolvedValue({ userId: 'u9', email: 'c@example.com' });
    hasher.hash.mockResolvedValue('argon2-hash');
    await useCase.execute(ctx, 'c1', 'NewPassw0rd!');
    expect(hasher.hash).toHaveBeenCalledWith('NewPassw0rd!');
    expect(adminSetPassword.setPasswordWithAudit).toHaveBeenCalledWith(
      'u9',
      'argon2-hash',
      expect.anything(),
    );
  });

  it('writes an audit entry naming the acting admin, atomically with the password update', async () => {
    repo.findClinicUser.mockResolvedValue({ userId: 'u9', email: 'c@example.com' });
    await useCase.execute(ctx, 'c1', 'NewPassw0rd!');
    // A single call carries both the new hash and the audit event together —
    // that's what guarantees they can only ever be written in one transaction
    // (see PrismaPasswordResetRepository.setPasswordWithAudit and the
    // rollback proof in admin-set-password.int-spec.ts).
    expect(adminSetPassword.setPasswordWithAudit).toHaveBeenCalledWith(
      'u9',
      expect.any(String),
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
    expect(adminSetPassword.setPasswordWithAudit).not.toHaveBeenCalled();
  });

  it('returns { success: true }', async () => {
    repo.findClinicUser.mockResolvedValue({ userId: 'u9', email: 'c@example.com' });
    await expect(useCase.execute(ctx, 'c1', 'NewPassw0rd!')).resolves.toEqual({ success: true });
  });

  it('propagates a failure from setPasswordWithAudit (nothing here catches or ignores it)', async () => {
    repo.findClinicUser.mockResolvedValue({ userId: 'u9', email: 'c@example.com' });
    adminSetPassword.setPasswordWithAudit.mockRejectedValue(new Error('audit write failed'));
    await expect(useCase.execute(ctx, 'c1', 'NewPassw0rd!')).rejects.toThrow('audit write failed');
  });
});

import { NotFoundException } from '@nestjs/common';
import { SetAdminPasswordUseCase } from '../set-admin-password.use-case';
import type { AdminTeamRepositoryPort } from '../../domain/ports/admin-team-repository.port';
import type { PasswordHasherPort } from '../../../auth/domain/ports/password-hasher.port';

const ctx = { userId: 'superadmin-1', role: 'superadmin', ip: '127.0.0.1' };

const makeRepo = (): jest.Mocked<AdminTeamRepositoryPort> => ({
  listAdmins: jest.fn(),
  createAdmin: jest.fn(),
  deleteAdmin: jest.fn(),
  setAdminPassword: jest.fn(),
});

const makeHasher = (): jest.Mocked<PasswordHasherPort> => ({
  hash: jest.fn().mockResolvedValue('hashed'),
  verify: jest.fn(),
});

describe('SetAdminPasswordUseCase', () => {
  let useCase: SetAdminPasswordUseCase;
  let repo: jest.Mocked<AdminTeamRepositoryPort>;
  let hasher: jest.Mocked<PasswordHasherPort>;

  beforeEach(() => {
    repo = makeRepo();
    hasher = makeHasher();
    useCase = new SetAdminPasswordUseCase(repo, hasher);
  });

  it('hashes the new password and stores the hash', async () => {
    hasher.hash.mockResolvedValue('argon2-hash');
    repo.setAdminPassword.mockResolvedValue(true);

    await useCase.execute(ctx, 'other-admin', 'NewPassw0rd!');

    expect(hasher.hash).toHaveBeenCalledWith('NewPassw0rd!');
    expect(repo.setAdminPassword).toHaveBeenCalledWith(ctx, 'other-admin', 'argon2-hash');
  });

  it('throws NotFoundException when the repository finds no matching admin row', async () => {
    repo.setAdminPassword.mockResolvedValue(false);
    await expect(useCase.execute(ctx, 'other-admin', 'NewPassw0rd!')).rejects.toThrow(
      NotFoundException,
    );
    await expect(useCase.execute(ctx, 'other-admin', 'NewPassw0rd!')).rejects.toThrow(
      'Admin user not found',
    );
  });

  it('allows a superadmin to set their own password and returns { success: true }', async () => {
    repo.setAdminPassword.mockResolvedValue(true);
    await expect(useCase.execute(ctx, ctx.userId, 'NewPassw0rd!')).resolves.toEqual({
      success: true,
    });
  });
});

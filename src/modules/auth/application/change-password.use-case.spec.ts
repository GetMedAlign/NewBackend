import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ChangePasswordUseCase } from './change-password.use-case';
import type { UserRepositoryPort } from '../domain/ports/user-repository.port';
import type { PasswordHasherPort } from '../domain/ports/password-hasher.port';
import { User } from '../domain/entities/user.entity';

const makeUser = (): User =>
  new User({
    id: 'user-1',
    email: 'user@example.com',
    passwordHash: 'current-hash',
    emailConfirmed: true,
    failedLoginCount: 0,
    lockedUntil: null,
    name: 'Jane',
  });

const makeRepo = (): jest.Mocked<UserRepositoryPort> => ({
  create: jest.fn(),
  findByEmail: jest.fn(),
  findById: jest.fn().mockResolvedValue(makeUser()),
  updatePasswordHash: jest.fn(),
  getPrimaryRole: jest.fn(),
  getClinicId: jest.fn(),
  recordFailedLogin: jest.fn(),
  resetFailedLogin: jest.fn(),
  setRecoveryPhone: jest.fn(),
  getRecoveryPhone: jest.fn(),
});

const makeHasher = (verifyResult: boolean): jest.Mocked<PasswordHasherPort> => ({
  hash: jest.fn().mockResolvedValue('new-hash'),
  verify: jest.fn().mockResolvedValue(verifyResult),
});

describe('ChangePasswordUseCase', () => {
  it('updates the password when the current password is correct', async () => {
    const repo = makeRepo();
    const hasher = makeHasher(true);
    const useCase = new ChangePasswordUseCase(repo, hasher);

    const result = await useCase.execute('user-1', 'current', 'newSecret1!');

    expect(hasher.verify).toHaveBeenCalledWith('current', 'current-hash');
    expect(hasher.hash).toHaveBeenCalledWith('newSecret1!');
    expect(repo.updatePasswordHash).toHaveBeenCalledWith('user-1', 'new-hash');
    expect(result).toEqual({ success: true });
  });

  it('rejects an incorrect current password without updating', async () => {
    const repo = makeRepo();
    const hasher = makeHasher(false);
    const useCase = new ChangePasswordUseCase(repo, hasher);

    await expect(useCase.execute('user-1', 'wrong', 'newSecret1!')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.updatePasswordHash).not.toHaveBeenCalled();
  });

  it('rejects when the user does not exist', async () => {
    const repo = makeRepo();
    repo.findById.mockResolvedValue(null);
    const hasher = makeHasher(true);
    const useCase = new ChangePasswordUseCase(repo, hasher);

    await expect(useCase.execute('missing', 'current', 'newSecret1!')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(repo.updatePasswordHash).not.toHaveBeenCalled();
  });
});

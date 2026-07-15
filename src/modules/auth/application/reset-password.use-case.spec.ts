import { BadRequestException } from '@nestjs/common';
import { ResetPasswordUseCase } from './reset-password.use-case';
import type { PasswordResetRepositoryPort } from '../domain/ports/password-reset-repository.port';
import type { PasswordHasherPort } from '../domain/ports/password-hasher.port';

const makeResetRepo = (): jest.Mocked<PasswordResetRepositoryPort> => ({
  findUserIdByEmail: jest.fn().mockResolvedValue(null),
  issue: jest.fn().mockResolvedValue(undefined),
  findValidByEmail: jest.fn().mockResolvedValue(null),
  consume: jest.fn().mockResolvedValue(undefined),
  updatePasswordHash: jest.fn().mockResolvedValue(undefined),
});

const makeHasher = (): jest.Mocked<PasswordHasherPort> => ({
  hash: jest.fn().mockResolvedValue('hashed-new-password'),
  verify: jest.fn().mockResolvedValue(true),
});

describe('ResetPasswordUseCase', () => {
  let useCase: ResetPasswordUseCase;
  let resetRepo: jest.Mocked<PasswordResetRepositoryPort>;
  let hasher: jest.Mocked<PasswordHasherPort>;

  beforeEach(() => {
    resetRepo = makeResetRepo();
    hasher = makeHasher();
    useCase = new ResetPasswordUseCase(resetRepo, hasher);
  });

  it('throws BadRequestException (400) when findValidByEmail returns null', async () => {
    resetRepo.findValidByEmail.mockResolvedValue(null);

    await expect(
      useCase.execute({ email: 'user@example.com', token: 'sometoken', newPassword: 'newpass123' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('hashes password, calls updatePasswordHash, calls consume, returns { success: true }', async () => {
    const record = { id: 'token-id-123', userId: 'user-id-456' };
    resetRepo.findValidByEmail.mockResolvedValue(record);

    const result = await useCase.execute({
      email: 'user@example.com',
      token: 'rawtoken',
      newPassword: 'newpass123',
    });

    expect(result).toEqual({ success: true });
    expect(hasher.hash).toHaveBeenCalledWith('newpass123');
    expect(resetRepo.updatePasswordHash).toHaveBeenCalledWith('user-id-456', 'hashed-new-password');
    expect(resetRepo.consume).toHaveBeenCalledWith('token-id-123');
  });

  it('calls updatePasswordHash before consume (order matters)', async () => {
    const callOrder: string[] = [];
    const record = { id: 'token-id-789', userId: 'user-id-789' };
    resetRepo.findValidByEmail.mockResolvedValue(record);
    resetRepo.updatePasswordHash.mockImplementation(async () => {
      callOrder.push('updatePasswordHash');
    });
    resetRepo.consume.mockImplementation(async () => {
      callOrder.push('consume');
    });

    await useCase.execute({ email: 'user@example.com', token: 'raw', newPassword: 'pass12345' });

    expect(callOrder).toEqual(['updatePasswordHash', 'consume']);
  });
});

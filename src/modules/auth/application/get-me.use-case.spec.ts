import { GetMeUseCase } from './get-me.use-case';
import { User } from '../domain/entities/user.entity';
import type { UserRepositoryPort } from '../domain/ports/user-repository.port';
import { InvalidCredentialsError } from '../domain/errors/invalid-credentials.error';

const makeUser = (): User =>
  new User({
    id: 'user-id',
    email: 'user@example.com',
    passwordHash: 'hash',
    emailConfirmed: true,
    failedLoginCount: 0,
    lockedUntil: null,
  });

const makeRepo = (): jest.Mocked<UserRepositoryPort> => ({
  create: jest.fn(),
  findByEmail: jest.fn(),
  findById: jest.fn().mockResolvedValue(makeUser()),
  getPrimaryRole: jest.fn().mockResolvedValue('patient'),
  recordFailedLogin: jest.fn(),
  resetFailedLogin: jest.fn(),
  setRecoveryPhone: jest.fn(),
  getRecoveryPhone: jest.fn(),
});

describe('GetMeUseCase', () => {
  let useCase: GetMeUseCase;
  let repo: jest.Mocked<UserRepositoryPort>;

  beforeEach(() => {
    repo = makeRepo();
    useCase = new GetMeUseCase(repo);
  });

  it('returns userId, email, and role for an existing user', async () => {
    repo.getPrimaryRole.mockResolvedValue('doctor');

    const result = await useCase.execute({ userId: 'user-id' });

    expect(result).toEqual({ userId: 'user-id', email: 'user@example.com', role: 'doctor' });
  });

  it('throws InvalidCredentialsError when user not found', async () => {
    repo.findById.mockResolvedValue(null);

    await expect(useCase.execute({ userId: 'no-such-id' })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  it('calls getPrimaryRole with the user id', async () => {
    await useCase.execute({ userId: 'user-id' });

    expect(repo.getPrimaryRole).toHaveBeenCalledWith('user-id');
  });
});

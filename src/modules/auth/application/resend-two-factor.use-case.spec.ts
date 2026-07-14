import { ResendTwoFactorUseCase } from './resend-two-factor.use-case';
import { User } from '../domain/entities/user.entity';
import type { TwoFactorPort } from '../domain/ports/two-factor.port';
import type { UserRepositoryPort } from '../domain/ports/user-repository.port';

const makeUser = (): User =>
  new User({
    id: 'user-id',
    email: 'user@example.com',
    passwordHash: 'hash',
    emailConfirmed: true,
    failedLoginCount: 0,
    lockedUntil: null,
  });

const makeTwoFactor = (): jest.Mocked<TwoFactorPort> => ({
  issueCode: jest.fn().mockResolvedValue(undefined),
  verifyCode: jest.fn(),
});

const makeRepo = (): jest.Mocked<UserRepositoryPort> => ({
  create: jest.fn(),
  findByEmail: jest.fn(),
  findById: jest.fn(),
  getPrimaryRole: jest.fn(),
  getClinicId: jest.fn().mockResolvedValue(null),
  recordFailedLogin: jest.fn(),
  resetFailedLogin: jest.fn(),
  setRecoveryPhone: jest.fn(),
  getRecoveryPhone: jest.fn(),
});

describe('ResendTwoFactorUseCase', () => {
  let useCase: ResendTwoFactorUseCase;
  let twoFactor: jest.Mocked<TwoFactorPort>;
  let repo: jest.Mocked<UserRepositoryPort>;

  beforeEach(() => {
    twoFactor = makeTwoFactor();
    repo = makeRepo();
    useCase = new ResendTwoFactorUseCase(twoFactor, repo);
  });

  it('returns { ok: true } when user exists', async () => {
    repo.findByEmail.mockResolvedValue(makeUser());

    const result = await useCase.execute({ email: 'user@example.com' });

    expect(result).toEqual({ ok: true });
  });

  it('returns { ok: true } when user does NOT exist (uniform — no enumeration)', async () => {
    repo.findByEmail.mockResolvedValue(null);

    const result = await useCase.execute({ email: 'ghost@example.com' });

    expect(result).toEqual({ ok: true });
  });

  it('calls twoFactor.issueCode when user exists', async () => {
    repo.findByEmail.mockResolvedValue(makeUser());

    await useCase.execute({ email: 'user@example.com' });

    expect(twoFactor.issueCode).toHaveBeenCalledWith('user-id');
  });

  it('does NOT call twoFactor.issueCode when user does not exist', async () => {
    repo.findByEmail.mockResolvedValue(null);

    await useCase.execute({ email: 'ghost@example.com' });

    expect(twoFactor.issueCode).not.toHaveBeenCalled();
  });
});

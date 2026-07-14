import { SignInUseCase } from './sign-in.use-case';
import { User } from '../domain/entities/user.entity';
import type { PasswordHasherPort } from '../domain/ports/password-hasher.port';
import type { TwoFactorPort } from '../domain/ports/two-factor.port';
import type { UserRepositoryPort } from '../domain/ports/user-repository.port';
import type { AuditPort } from '../domain/ports/audit.port';
import { InvalidCredentialsError } from '../domain/errors/invalid-credentials.error';
import { AccountLockedError } from '../domain/errors/account-locked.error';

const makeUser = (overrides?: Partial<ConstructorParameters<typeof User>[0]>): User =>
  new User({
    id: 'user-id',
    email: 'user@example.com',
    passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$abc$def',
    emailConfirmed: true,
    failedLoginCount: 0,
    lockedUntil: null,
    ...overrides,
  });

const makeHasher = (): jest.Mocked<PasswordHasherPort> => ({
  hash: jest.fn(),
  verify: jest.fn().mockResolvedValue(true),
});

const makeTwoFactor = (): jest.Mocked<TwoFactorPort> => ({
  issueCode: jest.fn().mockResolvedValue(undefined),
  verifyCode: jest.fn(),
});

const makeRepo = (): jest.Mocked<UserRepositoryPort> => ({
  create: jest.fn(),
  findByEmail: jest.fn().mockResolvedValue(null),
  findById: jest.fn(),
  getPrimaryRole: jest.fn(),
  getClinicId: jest.fn().mockResolvedValue(null),
  recordFailedLogin: jest.fn().mockResolvedValue(undefined),
  resetFailedLogin: jest.fn(),
  setRecoveryPhone: jest.fn(),
  getRecoveryPhone: jest.fn(),
});

const makeAudit = (): jest.Mocked<AuditPort> => ({
  record: jest.fn().mockResolvedValue(undefined),
});

describe('SignInUseCase', () => {
  let useCase: SignInUseCase;
  let hasher: jest.Mocked<PasswordHasherPort>;
  let twoFactor: jest.Mocked<TwoFactorPort>;
  let repo: jest.Mocked<UserRepositoryPort>;
  let audit: jest.Mocked<AuditPort>;

  beforeEach(() => {
    hasher = makeHasher();
    twoFactor = makeTwoFactor();
    repo = makeRepo();
    audit = makeAudit();
    useCase = new SignInUseCase(hasher, twoFactor, repo, audit);
  });

  describe('unknown email', () => {
    beforeEach(() => {
      repo.findByEmail.mockResolvedValue(null);
    });

    it('throws InvalidCredentialsError', async () => {
      await expect(
        useCase.execute({ email: 'unknown@example.com', password: 'pw' }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    });

    it('still calls hasher.verify with a dummy hash to equalise timing', async () => {
      hasher.verify.mockResolvedValue(false);

      await expect(
        useCase.execute({ email: 'unknown@example.com', password: 'my-password' }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);

      expect(hasher.verify).toHaveBeenCalledTimes(1);
      expect(hasher.verify).toHaveBeenCalledWith('my-password', expect.any(String));
    });
  });

  describe('locked account', () => {
    it('throws AccountLockedError when user.isLocked(now) is true', async () => {
      const lockedUntil = new Date(Date.now() + 60_000);
      repo.findByEmail.mockResolvedValue(makeUser({ lockedUntil }));

      await expect(
        useCase.execute({ email: 'user@example.com', password: 'pw' }),
      ).rejects.toBeInstanceOf(AccountLockedError);
    });
  });

  describe('wrong password', () => {
    beforeEach(() => {
      repo.findByEmail.mockResolvedValue(makeUser());
      hasher.verify.mockResolvedValue(false);
    });

    it('throws InvalidCredentialsError', async () => {
      await expect(
        useCase.execute({ email: 'user@example.com', password: 'wrong' }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    });

    it('calls repo.recordFailedLogin before throwing', async () => {
      await expect(
        useCase.execute({ email: 'user@example.com', password: 'wrong' }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);

      expect(repo.recordFailedLogin).toHaveBeenCalledWith('user-id');
    });
  });

  describe('correct password', () => {
    beforeEach(() => {
      repo.findByEmail.mockResolvedValue(makeUser());
      hasher.verify.mockResolvedValue(true);
    });

    it('calls twoFactor.issueCode with the user id', async () => {
      await useCase.execute({ email: 'user@example.com', password: 'correct' });

      expect(twoFactor.issueCode).toHaveBeenCalledWith('user-id');
    });

    it('result is exactly { requiresTwoFactor: true } with no token field', async () => {
      const result = await useCase.execute({ email: 'user@example.com', password: 'correct' });

      expect(result).toEqual({ requiresTwoFactor: true });
      expect(result).not.toHaveProperty('token');
    });

    it('records a signin_2fa_issued audit event', async () => {
      await useCase.execute({ email: 'user@example.com', password: 'correct', ip: '10.0.0.1' });

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'signin_2fa_issued',
          actorUserId: 'user-id',
          ip: '10.0.0.1',
        }),
      );
    });
  });
});

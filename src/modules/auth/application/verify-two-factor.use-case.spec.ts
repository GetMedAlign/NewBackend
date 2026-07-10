import { VerifyTwoFactorUseCase } from './verify-two-factor.use-case';
import { User } from '../domain/entities/user.entity';
import type { TokenServicePort } from '../domain/ports/token-service.port';
import type { TwoFactorPort } from '../domain/ports/two-factor.port';
import type { UserRepositoryPort } from '../domain/ports/user-repository.port';
import type { AuditPort } from '../domain/ports/audit.port';
import { InvalidTwoFactorCodeError } from '../domain/errors/invalid-two-factor-code.error';

const makeUser = (): User =>
  new User({
    id: 'user-id',
    email: 'user@example.com',
    passwordHash: 'hash',
    emailConfirmed: true,
    failedLoginCount: 0,
    lockedUntil: null,
  });

const makeTokens = (): jest.Mocked<TokenServicePort> => ({
  issue: jest.fn().mockReturnValue('issued-jwt'),
  verify: jest.fn(),
});

const makeTwoFactor = (): jest.Mocked<TwoFactorPort> => ({
  issueCode: jest.fn(),
  verifyCode: jest.fn().mockResolvedValue(true),
});

const makeRepo = (): jest.Mocked<UserRepositoryPort> => ({
  create: jest.fn(),
  findByEmail: jest.fn().mockResolvedValue(makeUser()),
  findById: jest.fn(),
  getPrimaryRole: jest.fn().mockResolvedValue('patient'),
  recordFailedLogin: jest.fn(),
  resetFailedLogin: jest.fn().mockResolvedValue(undefined),
});

const makeAudit = (): jest.Mocked<AuditPort> => ({
  record: jest.fn().mockResolvedValue(undefined),
});

describe('VerifyTwoFactorUseCase', () => {
  let useCase: VerifyTwoFactorUseCase;
  let tokens: jest.Mocked<TokenServicePort>;
  let twoFactor: jest.Mocked<TwoFactorPort>;
  let repo: jest.Mocked<UserRepositoryPort>;
  let audit: jest.Mocked<AuditPort>;

  beforeEach(() => {
    tokens = makeTokens();
    twoFactor = makeTwoFactor();
    repo = makeRepo();
    audit = makeAudit();
    useCase = new VerifyTwoFactorUseCase(tokens, twoFactor, repo, audit);
  });

  describe('unknown email', () => {
    it('throws InvalidTwoFactorCodeError (uniform - no enumeration)', async () => {
      repo.findByEmail.mockResolvedValue(null);

      await expect(
        useCase.execute({ email: 'ghost@example.com', code: '123456' }),
      ).rejects.toBeInstanceOf(InvalidTwoFactorCodeError);
    });
  });

  describe('bad code', () => {
    it('throws InvalidTwoFactorCodeError when verifyCode returns false', async () => {
      twoFactor.verifyCode.mockResolvedValue(false);

      await expect(
        useCase.execute({ email: 'user@example.com', code: 'wrong' }),
      ).rejects.toBeInstanceOf(InvalidTwoFactorCodeError);
    });
  });

  describe('correct code', () => {
    it('calls repo.resetFailedLogin after successful verification', async () => {
      await useCase.execute({ email: 'user@example.com', code: '123456' });

      expect(repo.resetFailedLogin).toHaveBeenCalledWith('user-id');
    });

    it('issues a token with { sub: userId, role }', async () => {
      repo.getPrimaryRole.mockResolvedValue('doctor');

      await useCase.execute({ email: 'user@example.com', code: '123456' });

      expect(tokens.issue).toHaveBeenCalledWith({ sub: 'user-id', role: 'doctor' });
    });

    it('returns { token, userId, role }', async () => {
      tokens.issue.mockReturnValue('my-jwt');
      repo.getPrimaryRole.mockResolvedValue('patient');

      const result = await useCase.execute({ email: 'user@example.com', code: '123456' });

      expect(result).toEqual({ token: 'my-jwt', userId: 'user-id', role: 'patient' });
    });

    it('records signin_succeeded audit event', async () => {
      await useCase.execute({ email: 'user@example.com', code: '123456', ip: '5.5.5.5' });

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'signin_succeeded',
          actorUserId: 'user-id',
          ip: '5.5.5.5',
        }),
      );
    });
  });
});

import { SignUpUseCase } from './sign-up.use-case';
import type { PasswordHasherPort } from '../domain/ports/password-hasher.port';
import type { UserRepositoryPort } from '../domain/ports/user-repository.port';
import type { AuditPort } from '../domain/ports/audit.port';
import { EmailAlreadyExistsError } from '../domain/errors/email-already-exists.error';
import { InvalidEmailError } from '../domain/value-objects/email';

const makeHasher = (): jest.Mocked<PasswordHasherPort> => ({
  hash: jest.fn().mockResolvedValue('hashed-pw'),
  verify: jest.fn(),
});

const makeRepo = (): jest.Mocked<UserRepositoryPort> => ({
  create: jest.fn().mockResolvedValue('new-user-id'),
  findByEmail: jest.fn(),
  findById: jest.fn(),
  getPrimaryRole: jest.fn(),
  recordFailedLogin: jest.fn(),
  resetFailedLogin: jest.fn(),
});

const makeAudit = (): jest.Mocked<AuditPort> => ({
  record: jest.fn().mockResolvedValue(undefined),
});

describe('SignUpUseCase', () => {
  let useCase: SignUpUseCase;
  let hasher: jest.Mocked<PasswordHasherPort>;
  let repo: jest.Mocked<UserRepositoryPort>;
  let audit: jest.Mocked<AuditPort>;

  beforeEach(() => {
    hasher = makeHasher();
    repo = makeRepo();
    audit = makeAudit();
    useCase = new SignUpUseCase(hasher, repo, audit);
  });

  it('hashes the password and passes the hash to repo.create', async () => {
    await useCase.execute({ email: 'user@example.com', password: 'secret' });

    expect(hasher.hash).toHaveBeenCalledWith('secret');
    expect(repo.create).toHaveBeenCalledWith('user@example.com', 'hashed-pw');
  });

  it('normalises email (trim + lowercase) before creating', async () => {
    await useCase.execute({ email: '  User@Example.COM  ', password: 'secret' });

    expect(repo.create).toHaveBeenCalledWith('user@example.com', 'hashed-pw');
  });

  it('returns the userId from repo.create', async () => {
    repo.create.mockResolvedValue('abc-123');

    const result = await useCase.execute({ email: 'user@example.com', password: 'pw' });

    expect(result).toEqual({ userId: 'abc-123' });
  });

  it('records a signup audit event with actorRole=patient', async () => {
    repo.create.mockResolvedValue('uid-999');

    await useCase.execute({ email: 'user@example.com', password: 'pw', ip: '1.2.3.4' });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'uid-999',
        actorRole: 'patient',
        actionType: 'signup',
        ip: '1.2.3.4',
      }),
    );
  });

  it('throws EmailAlreadyExistsError when repo signals duplicate email', async () => {
    repo.create.mockRejectedValue(new EmailAlreadyExistsError('user@example.com'));

    await expect(
      useCase.execute({ email: 'user@example.com', password: 'pw' }),
    ).rejects.toBeInstanceOf(EmailAlreadyExistsError);
  });

  it('throws InvalidEmailError on invalid email format', async () => {
    await expect(
      useCase.execute({ email: 'not-an-email', password: 'pw' }),
    ).rejects.toBeInstanceOf(InvalidEmailError);
  });
});

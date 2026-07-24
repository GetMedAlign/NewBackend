import { CreateAdminUseCase } from '../create-admin.use-case';
import type { AdminTeamRepositoryPort } from '../../domain/ports/admin-team-repository.port';
import type { PasswordHasherPort } from '../../../auth/domain/ports/password-hasher.port';
import { EmailAlreadyExistsError } from '../../../auth/domain/errors/email-already-exists.error';

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

describe('CreateAdminUseCase', () => {
  let useCase: CreateAdminUseCase;
  let repo: jest.Mocked<AdminTeamRepositoryPort>;
  let hasher: jest.Mocked<PasswordHasherPort>;

  beforeEach(() => {
    repo = makeRepo();
    hasher = makeHasher();
    useCase = new CreateAdminUseCase(repo, hasher);
  });

  it('hashes the password and passes the hash (never the plaintext) to the repository', async () => {
    hasher.hash.mockResolvedValue('argon2-hash');
    repo.createAdmin.mockResolvedValue({
      id: 'u1',
      name: 'Jane Doe',
      email: 'jane@example.com',
      role: 'admin',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    await useCase.execute(ctx, {
      name: 'Jane Doe',
      email: 'jane@example.com',
      password: 'PlaintextPass1!',
      role: 'admin',
    });

    expect(hasher.hash).toHaveBeenCalledWith('PlaintextPass1!');
    expect(repo.createAdmin).toHaveBeenCalledWith(ctx, {
      name: 'Jane Doe',
      email: 'jane@example.com',
      passwordHash: 'argon2-hash',
      role: 'admin',
    });
  });

  it('returns the created AdminUserRow', async () => {
    const created = {
      id: 'u1',
      name: 'Jane Doe',
      email: 'jane@example.com',
      role: 'superadmin' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    repo.createAdmin.mockResolvedValue(created);

    await expect(
      useCase.execute(ctx, {
        name: 'Jane Doe',
        email: 'jane@example.com',
        password: 'PlaintextPass1!',
        role: 'superadmin',
      }),
    ).resolves.toEqual(created);
  });

  it('propagates EmailAlreadyExistsError from the repository', async () => {
    repo.createAdmin.mockRejectedValue(new EmailAlreadyExistsError('jane@example.com'));

    await expect(
      useCase.execute(ctx, {
        name: 'Jane Doe',
        email: 'jane@example.com',
        password: 'PlaintextPass1!',
        role: 'admin',
      }),
    ).rejects.toThrow(EmailAlreadyExistsError);
  });
});

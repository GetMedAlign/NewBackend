import { ListAdminsUseCase } from '../list-admins.use-case';
import type { AdminTeamRepositoryPort } from '../../domain/ports/admin-team-repository.port';

const ctx = { userId: 'superadmin-1', role: 'superadmin', ip: '127.0.0.1' };

const makeRepo = (): jest.Mocked<AdminTeamRepositoryPort> => ({
  listAdmins: jest.fn(),
  createAdmin: jest.fn(),
  deleteAdmin: jest.fn(),
  setAdminPassword: jest.fn(),
});

describe('ListAdminsUseCase', () => {
  let useCase: ListAdminsUseCase;
  let repo: jest.Mocked<AdminTeamRepositoryPort>;

  beforeEach(() => {
    repo = makeRepo();
    useCase = new ListAdminsUseCase(repo);
  });

  it('delegates to the repository and returns its rows', async () => {
    const rows = [
      {
        id: 'u1',
        name: 'Jane Doe',
        email: 'jane@example.com',
        role: 'admin' as const,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    repo.listAdmins.mockResolvedValue(rows);

    await expect(useCase.execute(ctx)).resolves.toEqual(rows);
    expect(repo.listAdmins).toHaveBeenCalledWith(ctx);
  });
});

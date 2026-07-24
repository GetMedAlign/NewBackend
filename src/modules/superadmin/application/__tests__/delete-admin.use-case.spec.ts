import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DeleteAdminUseCase } from '../delete-admin.use-case';
import type { AdminTeamRepositoryPort } from '../../domain/ports/admin-team-repository.port';

const ctx = { userId: 'superadmin-1', role: 'superadmin', ip: '127.0.0.1' };

const makeRepo = (): jest.Mocked<AdminTeamRepositoryPort> => ({
  listAdmins: jest.fn(),
  createAdmin: jest.fn(),
  deleteAdmin: jest.fn(),
  setAdminPassword: jest.fn(),
});

describe('DeleteAdminUseCase', () => {
  let useCase: DeleteAdminUseCase;
  let repo: jest.Mocked<AdminTeamRepositoryPort>;

  beforeEach(() => {
    repo = makeRepo();
    useCase = new DeleteAdminUseCase(repo);
  });

  it('rejects deleting your own account without ever calling the repository', async () => {
    await expect(useCase.execute(ctx, ctx.userId)).rejects.toThrow(BadRequestException);
    await expect(useCase.execute(ctx, ctx.userId)).rejects.toThrow(
      'You cannot delete your own admin account.',
    );
    expect(repo.deleteAdmin).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the repository finds no matching admin row', async () => {
    repo.deleteAdmin.mockResolvedValue(false);
    await expect(useCase.execute(ctx, 'other-admin')).rejects.toThrow(NotFoundException);
    await expect(useCase.execute(ctx, 'other-admin')).rejects.toThrow('Admin user not found');
  });

  it('deletes another admin and returns { success: true }', async () => {
    repo.deleteAdmin.mockResolvedValue(true);
    await expect(useCase.execute(ctx, 'other-admin')).resolves.toEqual({ success: true });
    expect(repo.deleteAdmin).toHaveBeenCalledWith(ctx, 'other-admin');
  });
});

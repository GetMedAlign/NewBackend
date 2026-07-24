import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import type { AdminCtx } from '../../../infrastructure/security/admin-ctx';
import {
  ADMIN_TEAM_REPOSITORY,
  type AdminTeamRepositoryPort,
} from '../domain/ports/admin-team-repository.port';

/**
 * DELETE /superadmin/admins/:id: hard-deletes an admin/superadmin user
 * (user_roles cascades). A superadmin may never delete their own account
 * through this endpoint — that would lock the team out of team management —
 * so a self-target is rejected before the repository is even called.
 */
@Injectable()
export class DeleteAdminUseCase {
  constructor(@Inject(ADMIN_TEAM_REPOSITORY) private readonly repo: AdminTeamRepositoryPort) {}

  async execute(ctx: AdminCtx, targetId: string): Promise<{ success: true }> {
    if (targetId === ctx.userId) {
      throw new BadRequestException('You cannot delete your own admin account.');
    }

    const deleted = await this.repo.deleteAdmin(ctx, targetId);
    if (!deleted) throw new NotFoundException('Admin user not found');

    return { success: true };
  }
}

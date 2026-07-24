import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import type { AdminCtx } from '../../../infrastructure/security/admin-ctx';
import {
  PASSWORD_HASHER,
  type PasswordHasherPort,
} from '../../auth/domain/ports/password-hasher.port';
import {
  ADMIN_TEAM_REPOSITORY,
  type AdminTeamRepositoryPort,
} from '../domain/ports/admin-team-repository.port';

/**
 * PUT /superadmin/admins/:id/password: directly sets an admin/superadmin
 * user's password. A superadmin setting their own password is allowed (that
 * is not a lockout risk); only self-delete is guarded.
 */
@Injectable()
export class SetAdminPasswordUseCase {
  constructor(
    @Inject(ADMIN_TEAM_REPOSITORY) private readonly repo: AdminTeamRepositoryPort,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasherPort,
  ) {}

  async execute(ctx: AdminCtx, targetId: string, newPassword: string): Promise<{ success: true }> {
    const passwordHash = await this.hasher.hash(newPassword);
    const updated = await this.repo.setAdminPassword(ctx, targetId, passwordHash);
    if (!updated) throw new NotFoundException('Admin user not found');

    return { success: true };
  }
}

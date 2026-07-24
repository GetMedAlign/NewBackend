import { Inject, Injectable } from '@nestjs/common';

import type { AdminCtx } from '../../../infrastructure/security/admin-ctx';
import {
  ADMIN_TEAM_REPOSITORY,
  type AdminTeamRepositoryPort,
  type AdminUserRow,
} from '../domain/ports/admin-team-repository.port';

/** GET /superadmin/admins: lists every admin/superadmin user. */
@Injectable()
export class ListAdminsUseCase {
  constructor(@Inject(ADMIN_TEAM_REPOSITORY) private readonly repo: AdminTeamRepositoryPort) {}

  async execute(ctx: AdminCtx): Promise<AdminUserRow[]> {
    return this.repo.listAdmins(ctx);
  }
}

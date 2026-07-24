import { Inject, Injectable } from '@nestjs/common';

import type { AdminCtx } from '../../../infrastructure/security/admin-ctx';
import {
  PASSWORD_HASHER,
  type PasswordHasherPort,
} from '../../auth/domain/ports/password-hasher.port';
import {
  ADMIN_TEAM_REPOSITORY,
  type AdminRole,
  type AdminTeamRepositoryPort,
  type AdminUserRow,
} from '../domain/ports/admin-team-repository.port';

export interface CreateAdminCommand {
  name: string;
  email: string;
  password: string;
  role: AdminRole;
}

/**
 * POST /superadmin/admins: provisions a new admin/superadmin user. The
 * account is created with email_confirmed = true (provisioned directly by a
 * superadmin, not self-signup). The repository throws EmailAlreadyExistsError
 * when the email is already registered, which the global exception filter
 * maps to 409.
 */
@Injectable()
export class CreateAdminUseCase {
  constructor(
    @Inject(ADMIN_TEAM_REPOSITORY) private readonly repo: AdminTeamRepositoryPort,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasherPort,
  ) {}

  async execute(ctx: AdminCtx, input: CreateAdminCommand): Promise<AdminUserRow> {
    const passwordHash = await this.hasher.hash(input.password);
    return this.repo.createAdmin(ctx, {
      name: input.name,
      email: input.email,
      passwordHash,
      role: input.role,
    });
  }
}

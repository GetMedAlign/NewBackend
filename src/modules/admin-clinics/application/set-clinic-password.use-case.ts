import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import type { AdminCtx } from '../../../infrastructure/security/admin-ctx';
import { ADMIN_CLINIC_REPOSITORY } from '../domain/ports/admin-clinic-repository.port';
import type { AdminClinicRepositoryPort } from '../domain/ports/admin-clinic-repository.port';
import {
  ADMIN_SET_PASSWORD,
  AdminSetPasswordPort,
} from '../../auth/domain/ports/admin-set-password.port';
import { PASSWORD_HASHER, PasswordHasherPort } from '../../auth/domain/ports/password-hasher.port';

/**
 * POST /admin/clinics/:id/set-password: lets an admin set the clinic's linked
 * user's password directly, without a reset-token round trip. This is a
 * deliberate, human-approved contract-parity decision with an accepted
 * security risk (spec §4.4); the audit entry written on every success is one
 * of the agreed mitigations and must never be skipped.
 */
@Injectable()
export class SetClinicPasswordUseCase {
  constructor(
    @Inject(ADMIN_CLINIC_REPOSITORY) private readonly repo: AdminClinicRepositoryPort,
    @Inject(ADMIN_SET_PASSWORD) private readonly adminSetPassword: AdminSetPasswordPort,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasherPort,
  ) {}

  async execute(ctx: AdminCtx, clinicId: string, newPassword: string): Promise<{ success: true }> {
    const clinicUser = await this.repo.findClinicUser(ctx, clinicId);
    if (!clinicUser) throw new NotFoundException('No user account found for this clinic.');

    const passwordHash = await this.hasher.hash(newPassword);

    // Password update and admin_set_password audit write commit atomically —
    // see AdminSetPasswordPort — so a failed audit write can never leave a
    // changed password with no audit trail (spec §4.4 mitigation).
    await this.adminSetPassword.setPasswordWithAudit(clinicUser.userId, passwordHash, {
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      ip: ctx.ip,
      actionType: 'admin_set_password',
      affectedRecord: clinicUser.userId,
    });

    return { success: true };
  }
}

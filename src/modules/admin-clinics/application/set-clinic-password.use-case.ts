import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import type { AdminCtx } from '../../../infrastructure/security/admin-ctx';
import { ADMIN_CLINIC_REPOSITORY } from '../domain/ports/admin-clinic-repository.port';
import type { AdminClinicRepositoryPort } from '../domain/ports/admin-clinic-repository.port';
import {
  PASSWORD_RESET_REPOSITORY,
  PasswordResetRepositoryPort,
} from '../../auth/domain/ports/password-reset-repository.port';
import { PASSWORD_HASHER, PasswordHasherPort } from '../../auth/domain/ports/password-hasher.port';
import { AUDIT, AuditPort } from '../../auth/domain/ports/audit.port';

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
    @Inject(PASSWORD_RESET_REPOSITORY) private readonly resetRepo: PasswordResetRepositoryPort,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasherPort,
    @Inject(AUDIT) private readonly audit: AuditPort,
  ) {}

  async execute(ctx: AdminCtx, clinicId: string, newPassword: string): Promise<{ success: true }> {
    const clinicUser = await this.repo.findClinicUser(ctx, clinicId);
    if (!clinicUser) throw new NotFoundException('No user account found for this clinic.');

    const passwordHash = await this.hasher.hash(newPassword);
    await this.resetRepo.updatePasswordHash(clinicUser.userId, passwordHash);

    await this.audit.record({
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      ip: ctx.ip,
      actionType: 'admin_set_password',
      affectedRecord: clinicUser.userId,
    });

    return { success: true };
  }
}

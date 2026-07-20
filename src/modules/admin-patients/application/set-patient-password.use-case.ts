import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import type { AdminCtx } from '../../../infrastructure/security/admin-ctx';
import { ADMIN_PATIENT_REPOSITORY } from '../domain/ports/admin-patient-repository.port';
import type { AdminPatientRepositoryPort } from '../domain/ports/admin-patient-repository.port';
import {
  ADMIN_SET_PASSWORD,
  AdminSetPasswordPort,
} from '../../auth/domain/ports/admin-set-password.port';
import { PASSWORD_HASHER, PasswordHasherPort } from '../../auth/domain/ports/password-hasher.port';

/**
 * POST /admin/patients/:id/set-password: lets an admin set the patient's
 * linked user's password directly, without a reset-token round trip. This is
 * a deliberate, human-approved contract-parity decision with an accepted
 * security risk (spec §4.4); the audit entry written on every success is one
 * of the agreed mitigations and must never be skipped (mirrors Task 7's
 * set-clinic-password.use-case.ts).
 */
@Injectable()
export class SetPatientPasswordUseCase {
  constructor(
    @Inject(ADMIN_PATIENT_REPOSITORY) private readonly repo: AdminPatientRepositoryPort,
    @Inject(ADMIN_SET_PASSWORD) private readonly adminSetPassword: AdminSetPasswordPort,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasherPort,
  ) {}

  async execute(ctx: AdminCtx, patientId: string, newPassword: string): Promise<{ success: true }> {
    const patientUser = await this.repo.findPatientUser(ctx, patientId);
    if (!patientUser) throw new NotFoundException('Patient not found.');

    const passwordHash = await this.hasher.hash(newPassword);

    // Password update and admin_set_password audit write commit atomically —
    // see AdminSetPasswordPort — so a failed audit write can never leave a
    // changed password with no audit trail (spec §4.4 mitigation).
    await this.adminSetPassword.setPasswordWithAudit(patientUser.userId, passwordHash, {
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      ip: ctx.ip,
      actionType: 'admin_set_password',
      affectedRecord: patientUser.userId,
    });

    return { success: true };
  }
}

import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import type { AdminCtx } from '../../../infrastructure/security/admin-ctx';
import { ADMIN_PATIENT_REPOSITORY } from '../domain/ports/admin-patient-repository.port';
import type { AdminPatientRepositoryPort } from '../domain/ports/admin-patient-repository.port';
import {
  PASSWORD_RESET_REPOSITORY,
  PasswordResetRepositoryPort,
} from '../../auth/domain/ports/password-reset-repository.port';
import { PASSWORD_HASHER, PasswordHasherPort } from '../../auth/domain/ports/password-hasher.port';
import { AUDIT, AuditPort } from '../../auth/domain/ports/audit.port';

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
    @Inject(PASSWORD_RESET_REPOSITORY) private readonly resetRepo: PasswordResetRepositoryPort,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasherPort,
    @Inject(AUDIT) private readonly audit: AuditPort,
  ) {}

  async execute(ctx: AdminCtx, patientId: string, newPassword: string): Promise<{ success: true }> {
    const patientUser = await this.repo.findPatientUser(ctx, patientId);
    if (!patientUser) throw new NotFoundException('Patient not found.');

    const passwordHash = await this.hasher.hash(newPassword);
    await this.resetRepo.updatePasswordHash(patientUser.userId, passwordHash);

    await this.audit.record({
      actorUserId: ctx.userId,
      actorRole: ctx.role,
      ip: ctx.ip,
      actionType: 'admin_set_password',
      affectedRecord: patientUser.userId,
    });

    return { success: true };
  }
}

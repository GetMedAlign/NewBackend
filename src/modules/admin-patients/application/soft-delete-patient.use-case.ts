import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AdminCtx } from '../../../infrastructure/security/admin-ctx';
import { ADMIN_PATIENT_REPOSITORY } from '../domain/ports/admin-patient-repository.port';
import type { AdminPatientRepositoryPort } from '../domain/ports/admin-patient-repository.port';

@Injectable()
export class SoftDeletePatientUseCase {
  constructor(
    @Inject(ADMIN_PATIENT_REPOSITORY)
    private readonly repo: AdminPatientRepositoryPort,
  ) {}

  async execute(ctx: AdminCtx, patientId: string): Promise<{ success: true }> {
    const result = await this.repo.softDeletePatient(ctx, patientId);
    if (result === 'not_found') throw new NotFoundException('Patient not found.');
    if (result === 'already_deleted') throw new ConflictException('Patient already deleted.');
    return { success: true };
  }
}

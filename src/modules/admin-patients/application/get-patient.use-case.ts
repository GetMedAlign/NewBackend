import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AdminCtx } from '../../../infrastructure/security/admin-ctx';
import { ADMIN_PATIENT_REPOSITORY } from '../domain/ports/admin-patient-repository.port';
import type { AdminPatientRepositoryPort } from '../domain/ports/admin-patient-repository.port';
import type { AdminPatientDto } from '../domain/patient-dto.mapper';

@Injectable()
export class GetPatientUseCase {
  constructor(
    @Inject(ADMIN_PATIENT_REPOSITORY)
    private readonly repo: AdminPatientRepositoryPort,
  ) {}

  async execute(ctx: AdminCtx, patientId: string): Promise<AdminPatientDto> {
    const patient = await this.repo.getPatient(ctx, patientId);
    if (!patient) throw new NotFoundException('Patient not found.');
    return patient;
  }
}

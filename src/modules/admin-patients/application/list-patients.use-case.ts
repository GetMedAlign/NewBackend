import { Inject, Injectable } from '@nestjs/common';
import type { AdminCtx } from '../../../infrastructure/security/admin-ctx';
import { ADMIN_PATIENT_REPOSITORY } from '../domain/ports/admin-patient-repository.port';
import type { AdminPatientRepositoryPort } from '../domain/ports/admin-patient-repository.port';
import type { AdminPatientDto } from '../domain/patient-dto.mapper';

@Injectable()
export class ListPatientsUseCase {
  constructor(
    @Inject(ADMIN_PATIENT_REPOSITORY)
    private readonly repo: AdminPatientRepositoryPort,
  ) {}

  async execute(ctx: AdminCtx): Promise<AdminPatientDto[]> {
    return this.repo.listPatients(ctx);
  }
}

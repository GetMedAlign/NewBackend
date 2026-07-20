import { Inject, Injectable } from '@nestjs/common';
import type { AdminCtx } from '../../../infrastructure/security/admin-ctx';
import { ADMIN_CLINIC_REPOSITORY } from '../domain/ports/admin-clinic-repository.port';
import type { AdminClinicRepositoryPort } from '../domain/ports/admin-clinic-repository.port';
import type { AdminClinicDto } from '../domain/clinic-dto.mapper';

@Injectable()
export class ListClinicsUseCase {
  constructor(
    @Inject(ADMIN_CLINIC_REPOSITORY)
    private readonly repo: AdminClinicRepositoryPort,
  ) {}

  async execute(ctx: AdminCtx): Promise<AdminClinicDto[]> {
    return this.repo.listClinics(ctx);
  }
}

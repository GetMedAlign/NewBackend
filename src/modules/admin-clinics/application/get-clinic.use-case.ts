import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AdminCtx } from '../../../infrastructure/security/admin-ctx';
import { ADMIN_CLINIC_REPOSITORY } from '../domain/ports/admin-clinic-repository.port';
import type { AdminClinicRepositoryPort } from '../domain/ports/admin-clinic-repository.port';
import type { AdminClinicDto } from '../domain/clinic-dto.mapper';

@Injectable()
export class GetClinicUseCase {
  constructor(
    @Inject(ADMIN_CLINIC_REPOSITORY)
    private readonly repo: AdminClinicRepositoryPort,
  ) {}

  async execute(ctx: AdminCtx, clinicId: string): Promise<AdminClinicDto> {
    const clinic = await this.repo.getClinic(ctx, clinicId);
    if (!clinic) throw new NotFoundException('Clinic not found.');
    return clinic;
  }
}

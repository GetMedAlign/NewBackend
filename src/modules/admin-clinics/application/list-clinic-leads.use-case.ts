import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AdminCtx } from '../../../infrastructure/security/admin-ctx';
import { ADMIN_CLINIC_REPOSITORY } from '../domain/ports/admin-clinic-repository.port';
import type { AdminClinicRepositoryPort } from '../domain/ports/admin-clinic-repository.port';
import type { AdminLeadRow } from '../infrastructure/http/dto/admin-lead-row.dto';

@Injectable()
export class ListClinicLeadsUseCase {
  constructor(
    @Inject(ADMIN_CLINIC_REPOSITORY)
    private readonly repo: AdminClinicRepositoryPort,
  ) {}

  async execute(ctx: AdminCtx, clinicId: string): Promise<AdminLeadRow[]> {
    const exists = await this.repo.clinicExists(ctx, clinicId);
    if (!exists) throw new NotFoundException('Clinic not found.');
    return this.repo.listClinicLeads(ctx, clinicId);
  }
}

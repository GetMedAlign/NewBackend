import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AdminCtx } from '../../../infrastructure/security/admin-ctx';
import { ADMIN_CLINIC_REPOSITORY } from '../domain/ports/admin-clinic-repository.port';
import type { AdminClinicRepositoryPort } from '../domain/ports/admin-clinic-repository.port';

@Injectable()
export class PauseDeliveryUseCase {
  constructor(
    @Inject(ADMIN_CLINIC_REPOSITORY)
    private readonly repo: AdminClinicRepositoryPort,
  ) {}

  async execute(ctx: AdminCtx, clinicId: string, paused: boolean): Promise<void> {
    const found = await this.repo.pauseDelivery(ctx, clinicId, paused);
    if (!found) throw new NotFoundException('Clinic not found.');
  }
}

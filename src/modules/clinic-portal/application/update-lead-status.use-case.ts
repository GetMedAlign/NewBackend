import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { CLINIC_LEAD_REPOSITORY } from '../domain/ports/clinic-lead-repository.port';
import type { ClinicLeadRepositoryPort } from '../domain/ports/clinic-lead-repository.port';

@Injectable()
export class UpdateLeadStatusUseCase {
  constructor(
    @Inject(CLINIC_LEAD_REPOSITORY)
    private readonly repo: ClinicLeadRepositoryPort,
  ) {}

  async execute(clinicId: string, leadId: string, status: string): Promise<void> {
    const updated = await this.repo.updateStatus(clinicId, leadId, status);
    if (!updated) {
      throw new NotFoundException('Lead not found');
    }
  }
}

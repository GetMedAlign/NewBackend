import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { CLINIC_LEAD_REPOSITORY } from '../domain/ports/clinic-lead-repository.port';
import type {
  ClinicLeadRepositoryPort,
  ClinicLeadView,
} from '../domain/ports/clinic-lead-repository.port';

@Injectable()
export class GetClinicLeadUseCase {
  constructor(
    @Inject(CLINIC_LEAD_REPOSITORY)
    private readonly repo: ClinicLeadRepositoryPort,
  ) {}

  async execute(clinicId: string, leadId: string): Promise<ClinicLeadView> {
    const lead = await this.repo.findByClinic(clinicId, leadId);
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }
    return lead;
  }
}

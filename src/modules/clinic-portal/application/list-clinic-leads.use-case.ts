import { Injectable, Inject } from '@nestjs/common';
import { CLINIC_LEAD_REPOSITORY } from '../domain/ports/clinic-lead-repository.port';
import type {
  ClinicLeadRepositoryPort,
  ClinicLeadView,
} from '../domain/ports/clinic-lead-repository.port';

@Injectable()
export class ListClinicLeadsUseCase {
  constructor(
    @Inject(CLINIC_LEAD_REPOSITORY)
    private readonly repo: ClinicLeadRepositoryPort,
  ) {}

  async execute(clinicId: string): Promise<ClinicLeadView[]> {
    return this.repo.listByClinic(clinicId);
  }
}

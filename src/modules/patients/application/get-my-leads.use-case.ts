import { Injectable, Inject } from '@nestjs/common';
import { LEAD_REPOSITORY } from '../../leads/domain/ports/lead-repository.port';
import type {
  LeadRepositoryPort,
  PatientLeadView,
} from '../../leads/domain/ports/lead-repository.port';
import { PATIENT_REPOSITORY } from '../domain/ports/patient-repository.port';
import type { PatientRepositoryPort } from '../domain/ports/patient-repository.port';

@Injectable()
export class GetMyLeadsUseCase {
  constructor(
    @Inject(LEAD_REPOSITORY) private readonly leadRepository: LeadRepositoryPort,
    @Inject(PATIENT_REPOSITORY) private readonly patientRepository: PatientRepositoryPort,
  ) {}

  async execute(userId: string): Promise<PatientLeadView[]> {
    const profile = await this.patientRepository.findProfile(userId);
    if (!profile || !profile.hasPatient || profile.isDeleted) {
      return [];
    }
    return this.leadRepository.findByPatientUser(userId);
  }
}

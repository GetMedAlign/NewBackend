import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PATIENT_REPOSITORY } from '../domain/ports/patient-repository.port';
import type { PatientRepositoryPort } from '../domain/ports/patient-repository.port';

@Injectable()
export class DeleteAccountUseCase {
  constructor(
    @Inject(PATIENT_REPOSITORY) private readonly patientRepository: PatientRepositoryPort,
  ) {}

  async execute(userId: string): Promise<{ success: true }> {
    const result = await this.patientRepository.softDeleteSelf(userId);
    if (result === 'not_found') {
      throw new NotFoundException('No patient account to delete.');
    }
    // 'ok' and 'already_deleted' are both treated as success (idempotent).
    return { success: true };
  }
}

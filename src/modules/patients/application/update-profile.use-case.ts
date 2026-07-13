import { Injectable, Inject } from '@nestjs/common';
import { PATIENT_REPOSITORY } from '../domain/ports/patient-repository.port';
import type { PatientRepositoryPort } from '../domain/ports/patient-repository.port';
import { PatientNotFoundError } from '../domain/errors/patient-not-found.error';

export interface UpdateProfileInput {
  name: string;
  dob?: string;
}

@Injectable()
export class UpdateProfileUseCase {
  constructor(
    @Inject(PATIENT_REPOSITORY) private readonly patientRepository: PatientRepositoryPort,
  ) {}

  async execute(userId: string, input: UpdateProfileInput): Promise<void> {
    const profile = await this.patientRepository.findProfile(userId);
    if (profile && profile.hasPatient && profile.isDeleted) {
      throw new PatientNotFoundError();
    }
    await this.patientRepository.updateProfile(userId, input);
  }
}

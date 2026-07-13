import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PATIENT_REPOSITORY } from '../domain/ports/patient-repository.port';
import type { PatientRepositoryPort } from '../domain/ports/patient-repository.port';
import { PatientNotFoundError } from '../domain/errors/patient-not-found.error';

export interface GetProfileResult {
  name: string;
  email: string;
  dob: string | null;
  zipCode: string | null;
}

@Injectable()
export class GetProfileUseCase {
  constructor(
    @Inject(PATIENT_REPOSITORY) private readonly patientRepository: PatientRepositoryPort,
  ) {}

  async execute(userId: string): Promise<GetProfileResult> {
    const profile = await this.patientRepository.findProfile(userId);
    if (!profile) {
      // User doesn't exist at all — shouldn't happen for authenticated user
      throw new NotFoundException('Account not found.');
    }
    if (profile.hasPatient && profile.isDeleted) {
      throw new PatientNotFoundError();
    }
    return {
      name: profile.name ?? '',
      email: profile.email,
      dob: profile.dob ? this.formatDate(profile.dob) : null,
      zipCode: profile.zipCode ?? null,
    };
  }

  private formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}

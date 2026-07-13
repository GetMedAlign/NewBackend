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
    // Use UTC accessors: Postgres DATE columns arrive as JS Date at UTC midnight,
    // so local-time accessors would produce the wrong date on UTC-negative servers.
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}

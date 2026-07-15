import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { CLINIC_WRITE_REPOSITORY } from '../domain/ports/clinic-write-repository.port';
import type {
  ClinicWriteRepositoryPort,
  ClinicProfileView,
} from '../domain/ports/clinic-write-repository.port';

@Injectable()
export class GetClinicProfileUseCase {
  constructor(
    @Inject(CLINIC_WRITE_REPOSITORY)
    private readonly repo: ClinicWriteRepositoryPort,
  ) {}

  async execute(clinicId: string): Promise<ClinicProfileView> {
    const profile = await this.repo.findProfile(clinicId);
    if (!profile) {
      throw new NotFoundException('Clinic not found');
    }
    return profile;
  }
}

import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { CLINIC_WRITE_REPOSITORY } from '../domain/ports/clinic-write-repository.port';
import type {
  ClinicWriteRepositoryPort,
  UpdateClinicProfilePatch,
} from '../domain/ports/clinic-write-repository.port';

@Injectable()
export class UpdateClinicProfileUseCase {
  constructor(
    @Inject(CLINIC_WRITE_REPOSITORY)
    private readonly repo: ClinicWriteRepositoryPort,
  ) {}

  async execute(clinicId: string, patch: UpdateClinicProfilePatch): Promise<void> {
    if (patch.webhookUrl !== undefined && patch.webhookUrl !== null) {
      let url: URL;
      try {
        url = new URL(patch.webhookUrl);
      } catch {
        throw new BadRequestException('webhookUrl must be an absolute HTTPS URL');
      }
      if (url.protocol !== 'https:') {
        throw new BadRequestException('webhookUrl must be an absolute HTTPS URL');
      }
    }
    await this.repo.updateProfile(clinicId, patch);
  }
}

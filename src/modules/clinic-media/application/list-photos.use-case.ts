import { Inject, Injectable } from '@nestjs/common';
import { CLINIC_PHOTO_REPOSITORY } from '../domain/ports/clinic-photo-repository.port';
import type { ClinicPhotoRepositoryPort } from '../domain/ports/clinic-photo-repository.port';

export interface ListPhotosInput {
  clinicId: string;
}

@Injectable()
export class ListPhotosUseCase {
  constructor(@Inject(CLINIC_PHOTO_REPOSITORY) private readonly repo: ClinicPhotoRepositoryPort) {}

  async execute(input: ListPhotosInput): Promise<string[]> {
    return this.repo.listPhotoUrls(input.clinicId);
  }
}

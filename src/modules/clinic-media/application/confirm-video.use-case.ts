import { Inject, Injectable, Logger } from '@nestjs/common';
import { VIDEO_STORAGE_PORT } from '../domain/ports/storage.port';
import type { StoragePort } from '../domain/ports/storage.port';
import { CLINIC_PHOTO_REPOSITORY } from '../domain/ports/clinic-photo-repository.port';
import type { ClinicPhotoRepositoryPort } from '../domain/ports/clinic-photo-repository.port';
import { assertOwnedPath } from './assert-owned-path';

export interface ConfirmVideoInput {
  clinicId: string;
  path: string;
}

export interface ConfirmVideoResult {
  url: string;
}

@Injectable()
export class ConfirmVideoUseCase {
  private readonly logger = new Logger(ConfirmVideoUseCase.name);

  constructor(
    @Inject(VIDEO_STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(CLINIC_PHOTO_REPOSITORY) private readonly repo: ClinicPhotoRepositoryPort,
  ) {}

  async execute(input: ConfirmVideoInput): Promise<ConfirmVideoResult> {
    const { clinicId, path } = input;

    assertOwnedPath(path, `videos/${clinicId}/`);

    const oldUrl = await this.repo.getTourVideoUrl(clinicId);
    if (oldUrl) {
      const oldPath = this.storage.pathFromPublicUrl(oldUrl);
      if (oldPath) {
        try {
          await this.storage.remove([oldPath]);
        } catch (err) {
          this.logger.warn('Best-effort remove of old tour video failed', err);
        }
      }
    }

    const newUrl = this.storage.publicUrl(path);
    await this.repo.setTourVideoUrl(clinicId, newUrl);

    return { url: newUrl };
  }
}

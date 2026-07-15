import { Inject, Injectable, Logger } from '@nestjs/common';
import { STORAGE_PORT } from '../domain/ports/storage.port';
import type { StoragePort } from '../domain/ports/storage.port';
import { CLINIC_PHOTO_REPOSITORY } from '../domain/ports/clinic-photo-repository.port';
import type { ClinicPhotoRepositoryPort } from '../domain/ports/clinic-photo-repository.port';
import { assertOwnedPath } from './assert-owned-path';

export interface ConfirmLogoInput {
  clinicId: string;
  path: string;
}

export interface ConfirmLogoResult {
  url: string;
}

@Injectable()
export class ConfirmLogoUseCase {
  private readonly logger = new Logger(ConfirmLogoUseCase.name);

  constructor(
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(CLINIC_PHOTO_REPOSITORY) private readonly repo: ClinicPhotoRepositoryPort,
  ) {}

  async execute(input: ConfirmLogoInput): Promise<ConfirmLogoResult> {
    const { clinicId, path } = input;

    assertOwnedPath(path, `logos/${clinicId}/`);

    const oldUrl = await this.repo.getLogoUrl(clinicId);
    if (oldUrl) {
      const oldPath = this.storage.pathFromPublicUrl(oldUrl);
      if (oldPath) {
        try {
          await this.storage.remove([oldPath]);
        } catch (err) {
          this.logger.warn('Best-effort remove of old logo failed', err);
        }
      }
    }

    const newUrl = this.storage.publicUrl(path);
    await this.repo.setLogoUrl(clinicId, newUrl);

    return { url: newUrl };
  }
}

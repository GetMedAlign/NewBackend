import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { STORAGE_PORT } from '../domain/ports/storage.port';
import type { StoragePort } from '../domain/ports/storage.port';
import { CLINIC_PHOTO_REPOSITORY } from '../domain/ports/clinic-photo-repository.port';
import type { ClinicPhotoRepositoryPort } from '../domain/ports/clinic-photo-repository.port';
import { assertOwnedPath } from './assert-owned-path';

export interface ConfirmPhotosInput {
  clinicId: string;
  paths: string[];
}

export interface ConfirmPhotosResult {
  urls: string[];
}

@Injectable()
export class ConfirmPhotosUseCase {
  private readonly logger = new Logger(ConfirmPhotosUseCase.name);

  constructor(
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(CLINIC_PHOTO_REPOSITORY) private readonly repo: ClinicPhotoRepositoryPort,
  ) {}

  async execute(input: ConfirmPhotosInput): Promise<ConfirmPhotosResult> {
    const { clinicId, paths } = input;

    if (paths.length < 1 || paths.length > 8) {
      throw new BadRequestException('paths must contain between 1 and 8 items');
    }

    for (const path of paths) {
      assertOwnedPath(path, `photos/${clinicId}/`);
    }

    const oldUrls = await this.repo.listPhotoUrls(clinicId);
    if (oldUrls.length > 0) {
      const oldPaths = oldUrls
        .map((url) => this.storage.pathFromPublicUrl(url))
        .filter((p): p is string => p !== null);
      if (oldPaths.length > 0) {
        try {
          await this.storage.remove(oldPaths);
        } catch (err) {
          this.logger.warn('Best-effort remove of old photos failed', err);
        }
      }
    }

    const urls = paths.map((p) => this.storage.publicUrl(p));
    await this.repo.replacePhotos(clinicId, urls);

    return { urls };
  }
}

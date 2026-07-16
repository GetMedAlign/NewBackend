import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { STORAGE_PORT } from '../../clinic-media/domain/ports/storage.port';
import type { StoragePort } from '../../clinic-media/domain/ports/storage.port';

export interface SignApplicationPhotosInput {
  count: number;
}

export interface SignedApplicationPhotoUpload {
  uploadUrl: string;
  token: string;
  path: string;
}

export interface SignApplicationPhotosResult {
  uploads: SignedApplicationPhotoUpload[];
}

@Injectable()
export class SignApplicationPhotosUseCase {
  constructor(@Inject(STORAGE_PORT) private readonly storage: StoragePort) {}

  async execute(input: SignApplicationPhotosInput): Promise<SignApplicationPhotosResult> {
    const { count } = input;

    if (!Number.isInteger(count) || count < 1 || count > 8) {
      throw new BadRequestException('count must be an integer between 1 and 8');
    }

    const prefix = randomUUID();
    const uploads: SignedApplicationPhotoUpload[] = await Promise.all(
      Array.from({ length: count }, async () => {
        const path = `applications/${prefix}/${randomUUID()}`;
        const { uploadUrl, token } = await this.storage.createSignedUploadUrl(path);
        return { uploadUrl, token, path };
      }),
    );

    return { uploads };
  }
}

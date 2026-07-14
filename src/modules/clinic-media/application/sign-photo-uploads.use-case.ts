import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { STORAGE_PORT } from '../domain/ports/storage.port';
import type { StoragePort } from '../domain/ports/storage.port';

export interface SignPhotoUploadsInput {
  clinicId: string;
  count: number;
}

export interface SignedPhotoUpload {
  uploadUrl: string;
  token: string;
  path: string;
}

export interface SignPhotoUploadsResult {
  uploads: SignedPhotoUpload[];
}

@Injectable()
export class SignPhotoUploadsUseCase {
  constructor(@Inject(STORAGE_PORT) private readonly storage: StoragePort) {}

  async execute(input: SignPhotoUploadsInput): Promise<SignPhotoUploadsResult> {
    const { clinicId, count } = input;

    if (!Number.isInteger(count) || count < 1 || count > 8) {
      throw new BadRequestException('count must be an integer between 1 and 8');
    }

    const uploads: SignedPhotoUpload[] = await Promise.all(
      Array.from({ length: count }, async () => {
        const path = `photos/${clinicId}/${randomUUID()}`;
        const { uploadUrl, token } = await this.storage.createSignedUploadUrl(path);
        return { uploadUrl, token, path };
      }),
    );

    return { uploads };
  }
}

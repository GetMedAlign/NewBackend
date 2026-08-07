import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { VIDEO_STORAGE_PORT } from '../domain/ports/storage.port';
import type { StoragePort } from '../domain/ports/storage.port';

const ALLOWED_CONTENT_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'] as const;
type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

const EXT_MAP: Record<AllowedContentType, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

export interface SignVideoUploadInput {
  clinicId: string;
  contentType: string;
}

export interface SignVideoUploadResult {
  uploadUrl: string;
  token: string;
  path: string;
}

@Injectable()
export class SignVideoUploadUseCase {
  constructor(@Inject(VIDEO_STORAGE_PORT) private readonly storage: StoragePort) {}

  async execute(input: SignVideoUploadInput): Promise<SignVideoUploadResult> {
    if (!ALLOWED_CONTENT_TYPES.includes(input.contentType as AllowedContentType)) {
      throw new BadRequestException(
        `contentType must be one of: ${ALLOWED_CONTENT_TYPES.join(', ')}`,
      );
    }

    const ext = EXT_MAP[input.contentType as AllowedContentType];
    const path = `videos/${input.clinicId}/${randomUUID()}.${ext}`;
    const { uploadUrl, token } = await this.storage.createSignedUploadUrl(path);

    return { uploadUrl, token, path };
  }
}

import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { STORAGE_PORT } from '../../clinic-media/domain/ports/storage.port';
import type { StoragePort } from '../../clinic-media/domain/ports/storage.port';

const ALLOWED_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

const EXT_MAP: Record<AllowedContentType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export interface SignApplicationLogoInput {
  contentType: string;
}

export interface SignApplicationLogoResult {
  uploadUrl: string;
  token: string;
  path: string;
}

@Injectable()
export class SignApplicationLogoUseCase {
  constructor(@Inject(STORAGE_PORT) private readonly storage: StoragePort) {}

  async execute(input: SignApplicationLogoInput): Promise<SignApplicationLogoResult> {
    if (!ALLOWED_CONTENT_TYPES.includes(input.contentType as AllowedContentType)) {
      throw new BadRequestException(
        `contentType must be one of: ${ALLOWED_CONTENT_TYPES.join(', ')}`,
      );
    }

    const ext = EXT_MAP[input.contentType as AllowedContentType];
    const path = `applications/${randomUUID()}/logo.${ext}`;
    const { uploadUrl, token } = await this.storage.createSignedUploadUrl(path);

    return { uploadUrl, token, path };
  }
}

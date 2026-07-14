import { createClient } from '@supabase/supabase-js';
import { InternalServerErrorException, Logger } from '@nestjs/common';
import type { SignedUpload, StoragePort } from '../domain/ports/storage.port';

// Minimal seam covering the three StorageFileApi methods this adapter uses.
// The SDK returns discriminated unions (data+null error OR null data+StorageError);
// both branches are subtypes of the wider union below, so StorageFileApi is
// structurally assignable here and no cast is needed on the production path.
export interface StorageBucketSeam {
  createSignedUploadUrl(
    path: string,
  ): Promise<
    | { data: { signedUrl: string; token: string; path?: string }; error: null }
    | { data: null; error: { message: string } }
  >;
  getPublicUrl(path: string): { data: { publicUrl: string } };
  remove(
    paths: string[],
  ): Promise<{ data: unknown; error: null } | { data: null; error: { message: string } }>;
}

export class SupabaseStorageAdapter implements StoragePort {
  private readonly logger = new Logger(SupabaseStorageAdapter.name);
  private readonly bucket: StorageBucketSeam;

  constructor(
    config: { url: string; serviceRoleKey: string; bucket: string },
    bucketOverride?: StorageBucketSeam,
  ) {
    if (bucketOverride) {
      this.bucket = bucketOverride;
    } else {
      this.bucket = createClient(config.url, config.serviceRoleKey).storage.from(config.bucket);
    }
  }

  async createSignedUploadUrl(path: string): Promise<SignedUpload> {
    const { data, error } = await this.bucket.createSignedUploadUrl(path);
    if (error || !data) {
      this.logger.error('createSignedUploadUrl failed', error?.message);
      throw new InternalServerErrorException('Storage unavailable');
    }
    return { uploadUrl: data.signedUrl, token: data.token };
  }

  publicUrl(path: string): string {
    const { data } = this.bucket.getPublicUrl(path);
    return data.publicUrl;
  }

  async remove(paths: string[]): Promise<void> {
    const { error } = await this.bucket.remove(paths);
    if (error) {
      this.logger.error('remove failed', error.message);
      throw new InternalServerErrorException('Storage remove failed');
    }
  }
}

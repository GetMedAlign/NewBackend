import { createClient } from '@supabase/supabase-js';
import { InternalServerErrorException } from '@nestjs/common';
import type { SignedUpload, StoragePort } from '../domain/ports/storage.port';

export interface StorageBucketSeam {
  createSignedUploadUrl(path: string): Promise<{
    data: { signedUrl: string; token: string } | null;
    error: { message: string } | null;
  }>;
  getPublicUrl(path: string): { data: { publicUrl: string } };
  remove(paths: string[]): Promise<{ data: unknown | null; error: { message: string } | null }>;
}

export class SupabaseStorageAdapter implements StoragePort {
  private readonly bucket: StorageBucketSeam;

  constructor(
    config: { url: string; serviceRoleKey: string; bucket: string },
    bucketOverride?: StorageBucketSeam,
  ) {
    if (bucketOverride) {
      this.bucket = bucketOverride;
    } else {
      this.bucket = createClient(config.url, config.serviceRoleKey).storage.from(
        config.bucket,
      ) as unknown as StorageBucketSeam;
    }
  }

  async createSignedUploadUrl(path: string): Promise<SignedUpload> {
    const { data, error } = await this.bucket.createSignedUploadUrl(path);
    if (error || !data) {
      throw new InternalServerErrorException(`Storage error: ${error?.message ?? 'unknown error'}`);
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
      throw new InternalServerErrorException(`Storage remove error: ${error.message}`);
    }
  }
}

export interface SignedUpload {
  uploadUrl: string;
  token: string;
}

export interface StoragePort {
  createSignedUploadUrl(path: string): Promise<SignedUpload>;
  publicUrl(path: string): string;
  remove(paths: string[]): Promise<void>;
  pathFromPublicUrl(url: string): string | null;
}

export const STORAGE_PORT = Symbol('StoragePort');

/**
 * Same StoragePort interface, bound to the separate `clinic-videos` bucket
 * (SUPABASE_VIDEO_BUCKET) used for the clinic tour video upload flow.
 */
export const VIDEO_STORAGE_PORT = Symbol('VideoStoragePort');

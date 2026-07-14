export interface SignedUpload {
  uploadUrl: string;
  token: string;
}

export interface StoragePort {
  createSignedUploadUrl(path: string): Promise<SignedUpload>;
  publicUrl(path: string): string;
  remove(paths: string[]): Promise<void>;
}

export const STORAGE_PORT = Symbol('StoragePort');

import { InternalServerErrorException } from '@nestjs/common';
import { SupabaseStorageAdapter } from '../supabase-storage.adapter';
import type { StorageBucketSeam } from '../supabase-storage.adapter';

const TEST_CONFIG = {
  url: 'https://test.supabase.co',
  serviceRoleKey: 'test-key',
  bucket: 'clinic-media',
};

describe('SupabaseStorageAdapter', () => {
  let seam: jest.Mocked<StorageBucketSeam>;
  let adapter: SupabaseStorageAdapter;

  beforeEach(() => {
    seam = {
      createSignedUploadUrl: jest.fn(),
      getPublicUrl: jest.fn(),
      remove: jest.fn(),
    };
    adapter = new SupabaseStorageAdapter(TEST_CONFIG, seam);
  });

  describe('createSignedUploadUrl', () => {
    it('maps { data: { signedUrl, token } } to { uploadUrl, token }', async () => {
      seam.createSignedUploadUrl.mockResolvedValue({
        data: { signedUrl: 'https://storage.test/signed', token: 'my-token' },
        error: null,
      });

      const result = await adapter.createSignedUploadUrl('logos/clinic-1/photo.png');
      expect(result).toEqual({ uploadUrl: 'https://storage.test/signed', token: 'my-token' });
    });

    it('throws InternalServerErrorException when error is returned', async () => {
      seam.createSignedUploadUrl.mockResolvedValue({
        data: null,
        error: { message: 'bucket not found' },
      });

      await expect(
        adapter.createSignedUploadUrl('logos/clinic-1/photo.png'),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });

    it('throws InternalServerErrorException when data is null and no error', async () => {
      seam.createSignedUploadUrl.mockResolvedValue({ data: null, error: null });

      await expect(
        adapter.createSignedUploadUrl('logos/clinic-1/photo.png'),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });

  describe('publicUrl', () => {
    it('returns publicUrl from getPublicUrl', () => {
      seam.getPublicUrl.mockReturnValue({
        data: { publicUrl: 'https://storage.test/public/path' },
      });

      const url = adapter.publicUrl('logos/clinic-1/photo.png');
      expect(url).toBe('https://storage.test/public/path');
      expect(seam.getPublicUrl).toHaveBeenCalledWith('logos/clinic-1/photo.png');
    });
  });

  describe('remove', () => {
    it('calls remove with correct paths', async () => {
      seam.remove.mockResolvedValue({ data: [], error: null });

      await adapter.remove(['logos/clinic-1/a.png', 'logos/clinic-1/b.png']);
      expect(seam.remove).toHaveBeenCalledWith(['logos/clinic-1/a.png', 'logos/clinic-1/b.png']);
    });

    it('throws InternalServerErrorException when error is returned', async () => {
      seam.remove.mockResolvedValue({ data: null, error: { message: 'permission denied' } });

      await expect(adapter.remove(['logos/clinic-1/a.png'])).rejects.toBeInstanceOf(
        InternalServerErrorException,
      );
    });
  });
});

import { SupabaseStorageAdapter } from '../supabase-storage.adapter';
import type { StorageBucketSeam } from '../supabase-storage.adapter';

const TEST_CONFIG = {
  url: 'https://test.supabase.co',
  serviceRoleKey: 'test-key',
  bucket: 'clinic-media',
};

describe('SupabaseStorageAdapter.pathFromPublicUrl', () => {
  let seam: jest.Mocked<StorageBucketSeam>;
  let adapter: SupabaseStorageAdapter;

  beforeEach(() => {
    seam = {
      createSignedUploadUrl: jest.fn(),
      getPublicUrl: jest.fn().mockImplementation((path: string) => ({
        data: {
          publicUrl: `${TEST_CONFIG.url}/storage/v1/object/public/${TEST_CONFIG.bucket}/${path}`,
        },
      })),
      remove: jest.fn(),
    };
    adapter = new SupabaseStorageAdapter(TEST_CONFIG, seam);
  });

  it('round-trips: pathFromPublicUrl(publicUrl(path)) === path', () => {
    const path = 'logos/clinic-1/photo.png';
    const url = adapter.publicUrl(path);
    expect(adapter.pathFromPublicUrl(url)).toBe(path);
  });

  it('returns null on a non-matching URL', () => {
    expect(adapter.pathFromPublicUrl('https://other.com/some/path')).toBeNull();
  });

  it('returns null when URL matches base but has wrong bucket', () => {
    const wrongBucketUrl = `${TEST_CONFIG.url}/storage/v1/object/public/other-bucket/logos/file.png`;
    expect(adapter.pathFromPublicUrl(wrongBucketUrl)).toBeNull();
  });
});

import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SignApplicationPhotosUseCase } from '../sign-application-photos.use-case';
import { STORAGE_PORT } from '../../../clinic-media/domain/ports/storage.port';
import type { StoragePort } from '../../../clinic-media/domain/ports/storage.port';

describe('SignApplicationPhotosUseCase', () => {
  let useCase: SignApplicationPhotosUseCase;
  let mockStorage: jest.Mocked<StoragePort>;

  beforeEach(async () => {
    mockStorage = {
      createSignedUploadUrl: jest
        .fn()
        .mockImplementation((path: string) =>
          Promise.resolve({ uploadUrl: `https://storage.test/${path}`, token: 'tok' }),
        ),
      publicUrl: jest.fn().mockReturnValue('https://storage.test/public'),
      remove: jest.fn().mockResolvedValue(undefined),
      pathFromPublicUrl: jest.fn().mockReturnValue(null),
    };

    const module = await Test.createTestingModule({
      providers: [SignApplicationPhotosUseCase, { provide: STORAGE_PORT, useValue: mockStorage }],
    }).compile();

    useCase = module.get(SignApplicationPhotosUseCase);
  });

  it('throws BadRequestException when count is 0', async () => {
    await expect(useCase.execute({ count: 0 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws BadRequestException when count is 9', async () => {
    await expect(useCase.execute({ count: 9 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws BadRequestException for a non-integer count', async () => {
    await expect(useCase.execute({ count: 2.5 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns uploads array with correct length and all paths starting applications/', async () => {
    const result = await useCase.execute({ count: 3 });
    expect(result.uploads).toHaveLength(3);
    for (const upload of result.uploads) {
      expect(upload.path.startsWith('applications/')).toBe(true);
    }
  });

  it('returns distinct paths', async () => {
    const result = await useCase.execute({ count: 4 });
    const paths = result.uploads.map((u) => u.path);
    const unique = new Set(paths);
    expect(unique.size).toBe(4);
  });

  it('calls storage.createSignedUploadUrl exactly count times', async () => {
    await useCase.execute({ count: 5 });
    expect(mockStorage.createSignedUploadUrl).toHaveBeenCalledTimes(5);
  });

  it('each path starts with applications/ and contains a uuid segment', async () => {
    const result = await useCase.execute({ count: 2 });
    for (const upload of result.uploads) {
      expect(upload.path).toMatch(/^applications\/[0-9a-f-]+\//);
    }
  });

  it('returns { uploads: [{ uploadUrl, token, path }] } structure', async () => {
    const result = await useCase.execute({ count: 1 });
    expect(result).toHaveProperty('uploads');
    expect(Array.isArray(result.uploads)).toBe(true);
    const upload = result.uploads[0]!;
    expect(typeof upload.uploadUrl).toBe('string');
    expect(typeof upload.token).toBe('string');
    expect(typeof upload.path).toBe('string');
  });
});

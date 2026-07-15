import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SignPhotoUploadsUseCase } from '../sign-photo-uploads.use-case';
import { STORAGE_PORT } from '../../domain/ports/storage.port';
import type { StoragePort } from '../../domain/ports/storage.port';

const CLINIC_ID = 'clinic-456';

describe('SignPhotoUploadsUseCase', () => {
  let useCase: SignPhotoUploadsUseCase;
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
      providers: [SignPhotoUploadsUseCase, { provide: STORAGE_PORT, useValue: mockStorage }],
    }).compile();

    useCase = module.get(SignPhotoUploadsUseCase);
  });

  it('throws BadRequestException when count is 0', async () => {
    await expect(useCase.execute({ clinicId: CLINIC_ID, count: 0 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws BadRequestException when count is 9', async () => {
    await expect(useCase.execute({ clinicId: CLINIC_ID, count: 9 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws BadRequestException for a non-integer count', async () => {
    await expect(useCase.execute({ clinicId: CLINIC_ID, count: 2.5 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('returns uploads array with correct length and paths starting photos/<clinicId>/', async () => {
    const result = await useCase.execute({ clinicId: CLINIC_ID, count: 3 });
    expect(result.uploads).toHaveLength(3);
    for (const upload of result.uploads) {
      expect(upload.path.startsWith(`photos/${CLINIC_ID}/`)).toBe(true);
    }
  });

  it('returns distinct paths', async () => {
    const result = await useCase.execute({ clinicId: CLINIC_ID, count: 4 });
    const paths = result.uploads.map((u) => u.path);
    const unique = new Set(paths);
    expect(unique.size).toBe(4);
  });

  it('calls storage.createSignedUploadUrl exactly count times', async () => {
    await useCase.execute({ clinicId: CLINIC_ID, count: 5 });
    expect(mockStorage.createSignedUploadUrl).toHaveBeenCalledTimes(5);
  });
});

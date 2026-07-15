import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfirmPhotosUseCase } from '../confirm-photos.use-case';
import { STORAGE_PORT } from '../../domain/ports/storage.port';
import type { StoragePort } from '../../domain/ports/storage.port';
import { CLINIC_PHOTO_REPOSITORY } from '../../domain/ports/clinic-photo-repository.port';
import type { ClinicPhotoRepositoryPort } from '../../domain/ports/clinic-photo-repository.port';

const CLINIC_ID = 'clinic-xyz';

describe('ConfirmPhotosUseCase', () => {
  let useCase: ConfirmPhotosUseCase;
  let mockStorage: jest.Mocked<StoragePort>;
  let mockRepo: jest.Mocked<ClinicPhotoRepositoryPort>;

  beforeEach(async () => {
    mockStorage = {
      createSignedUploadUrl: jest.fn(),
      publicUrl: jest.fn().mockImplementation((path: string) => `https://storage.test/${path}`),
      remove: jest.fn().mockResolvedValue(undefined),
      pathFromPublicUrl: jest.fn().mockImplementation((url: string) => {
        const m = /^https:\/\/storage\.test\/(.+)$/.exec(url);
        return m ? m[1] : null;
      }),
    };

    mockRepo = {
      getLogoUrl: jest.fn().mockResolvedValue(null),
      setLogoUrl: jest.fn().mockResolvedValue(undefined),
      listPhotoUrls: jest.fn().mockResolvedValue([]),
      replacePhotos: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        ConfirmPhotosUseCase,
        { provide: STORAGE_PORT, useValue: mockStorage },
        { provide: CLINIC_PHOTO_REPOSITORY, useValue: mockRepo },
      ],
    }).compile();

    useCase = module.get(ConfirmPhotosUseCase);
  });

  it('throws BadRequestException when paths has 9 items', async () => {
    const paths = Array.from({ length: 9 }, (_, i) => `photos/${CLINIC_ID}/${i}.png`);
    await expect(useCase.execute({ clinicId: CLINIC_ID, paths })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws ForbiddenException for a foreign path prefix', async () => {
    await expect(
      useCase.execute({ clinicId: CLINIC_ID, paths: ['photos/other-clinic/a.png'] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('calls replacePhotos with publicUrl of each path', async () => {
    const paths = [`photos/${CLINIC_ID}/a.png`, `photos/${CLINIC_ID}/b.png`];
    const result = await useCase.execute({ clinicId: CLINIC_ID, paths });
    expect(mockRepo.replacePhotos).toHaveBeenCalledWith(CLINIC_ID, [
      `https://storage.test/photos/${CLINIC_ID}/a.png`,
      `https://storage.test/photos/${CLINIC_ID}/b.png`,
    ]);
    expect(result.urls).toHaveLength(2);
  });

  it('removes old objects best-effort before replacing', async () => {
    const oldUrl = `https://storage.test/photos/${CLINIC_ID}/old.png`;
    mockRepo.listPhotoUrls.mockResolvedValue([oldUrl]);
    mockStorage.remove.mockRejectedValue(new Error('network error'));

    const paths = [`photos/${CLINIC_ID}/new.png`];
    await expect(useCase.execute({ clinicId: CLINIC_ID, paths })).resolves.toBeDefined();
    expect(mockRepo.replacePhotos).toHaveBeenCalled();
  });
});

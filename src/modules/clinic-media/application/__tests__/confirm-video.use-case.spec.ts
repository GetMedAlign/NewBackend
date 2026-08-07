import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ConfirmVideoUseCase } from '../confirm-video.use-case';
import { VIDEO_STORAGE_PORT } from '../../domain/ports/storage.port';
import type { StoragePort } from '../../domain/ports/storage.port';
import { CLINIC_PHOTO_REPOSITORY } from '../../domain/ports/clinic-photo-repository.port';
import type { ClinicPhotoRepositoryPort } from '../../domain/ports/clinic-photo-repository.port';

const CLINIC_ID = 'clinic-abc';

describe('ConfirmVideoUseCase', () => {
  let useCase: ConfirmVideoUseCase;
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
      getTourVideoUrl: jest.fn().mockResolvedValue(null),
      setTourVideoUrl: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        ConfirmVideoUseCase,
        { provide: VIDEO_STORAGE_PORT, useValue: mockStorage },
        { provide: CLINIC_PHOTO_REPOSITORY, useValue: mockRepo },
      ],
    }).compile();

    useCase = module.get(ConfirmVideoUseCase);
  });

  it('computes new public URL and calls setTourVideoUrl', async () => {
    const path = `videos/${CLINIC_ID}/test.mp4`;
    const result = await useCase.execute({ clinicId: CLINIC_ID, path });
    expect(mockStorage.publicUrl).toHaveBeenCalledWith(path);
    expect(mockRepo.setTourVideoUrl).toHaveBeenCalledWith(
      CLINIC_ID,
      `https://storage.test/${path}`,
    );
    expect(result.url).toBe(`https://storage.test/${path}`);
  });

  it('calls remove with old path when there is a prior video', async () => {
    const oldUrl = `https://storage.test/videos/${CLINIC_ID}/old.mp4`;
    mockRepo.getTourVideoUrl.mockResolvedValue(oldUrl);

    const path = `videos/${CLINIC_ID}/new.mp4`;
    await useCase.execute({ clinicId: CLINIC_ID, path });

    expect(mockStorage.pathFromPublicUrl).toHaveBeenCalledWith(oldUrl);
    expect(mockStorage.remove).toHaveBeenCalledWith([`videos/${CLINIC_ID}/old.mp4`]);
  });

  it('throws ForbiddenException for a foreign clinic prefix', async () => {
    await expect(
      useCase.execute({ clinicId: CLINIC_ID, path: 'videos/other-clinic/file.mp4' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('still sets video url even if remove throws (best-effort)', async () => {
    const oldUrl = `https://storage.test/videos/${CLINIC_ID}/old.mp4`;
    mockRepo.getTourVideoUrl.mockResolvedValue(oldUrl);
    mockStorage.remove.mockRejectedValue(new Error('storage down'));

    const path = `videos/${CLINIC_ID}/new.mp4`;
    await expect(useCase.execute({ clinicId: CLINIC_ID, path })).resolves.toBeDefined();
    expect(mockRepo.setTourVideoUrl).toHaveBeenCalledWith(
      CLINIC_ID,
      `https://storage.test/${path}`,
    );
  });
});

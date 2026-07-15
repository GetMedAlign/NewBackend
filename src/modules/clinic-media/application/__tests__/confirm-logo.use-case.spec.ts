import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ConfirmLogoUseCase } from '../confirm-logo.use-case';
import { STORAGE_PORT } from '../../domain/ports/storage.port';
import type { StoragePort } from '../../domain/ports/storage.port';
import { CLINIC_PHOTO_REPOSITORY } from '../../domain/ports/clinic-photo-repository.port';
import type { ClinicPhotoRepositoryPort } from '../../domain/ports/clinic-photo-repository.port';

const CLINIC_ID = 'clinic-abc';

describe('ConfirmLogoUseCase', () => {
  let useCase: ConfirmLogoUseCase;
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
        ConfirmLogoUseCase,
        { provide: STORAGE_PORT, useValue: mockStorage },
        { provide: CLINIC_PHOTO_REPOSITORY, useValue: mockRepo },
      ],
    }).compile();

    useCase = module.get(ConfirmLogoUseCase);
  });

  it('computes new public URL and calls setLogoUrl', async () => {
    const path = `logos/${CLINIC_ID}/test.png`;
    const result = await useCase.execute({ clinicId: CLINIC_ID, path });
    expect(mockStorage.publicUrl).toHaveBeenCalledWith(path);
    expect(mockRepo.setLogoUrl).toHaveBeenCalledWith(CLINIC_ID, `https://storage.test/${path}`);
    expect(result.url).toBe(`https://storage.test/${path}`);
  });

  it('calls remove with old path when there is a prior logo', async () => {
    const oldUrl = `https://storage.test/logos/${CLINIC_ID}/old.png`;
    mockRepo.getLogoUrl.mockResolvedValue(oldUrl);

    const path = `logos/${CLINIC_ID}/new.png`;
    await useCase.execute({ clinicId: CLINIC_ID, path });

    expect(mockStorage.pathFromPublicUrl).toHaveBeenCalledWith(oldUrl);
    expect(mockStorage.remove).toHaveBeenCalledWith([`logos/${CLINIC_ID}/old.png`]);
  });

  it('throws ForbiddenException for a foreign clinic prefix', async () => {
    await expect(
      useCase.execute({ clinicId: CLINIC_ID, path: 'logos/other-clinic/file.png' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('still sets logo url even if remove throws (best-effort)', async () => {
    const oldUrl = `https://storage.test/logos/${CLINIC_ID}/old.png`;
    mockRepo.getLogoUrl.mockResolvedValue(oldUrl);
    mockStorage.remove.mockRejectedValue(new Error('storage down'));

    const path = `logos/${CLINIC_ID}/new.png`;
    await expect(useCase.execute({ clinicId: CLINIC_ID, path })).resolves.toBeDefined();
    expect(mockRepo.setLogoUrl).toHaveBeenCalledWith(CLINIC_ID, `https://storage.test/${path}`);
  });
});

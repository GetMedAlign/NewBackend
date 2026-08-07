import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SignVideoUploadUseCase } from '../sign-video-upload.use-case';
import { VIDEO_STORAGE_PORT } from '../../domain/ports/storage.port';
import type { StoragePort } from '../../domain/ports/storage.port';

const CLINIC_ID = 'clinic-123';

describe('SignVideoUploadUseCase', () => {
  let useCase: SignVideoUploadUseCase;
  let mockStorage: jest.Mocked<StoragePort>;

  beforeEach(async () => {
    mockStorage = {
      createSignedUploadUrl: jest.fn().mockResolvedValue({
        uploadUrl: 'https://storage.test/signed-url',
        token: 'test-token',
      }),
      publicUrl: jest.fn().mockReturnValue('https://storage.test/public'),
      remove: jest.fn().mockResolvedValue(undefined),
      pathFromPublicUrl: jest.fn().mockReturnValue(null),
    };

    const module = await Test.createTestingModule({
      providers: [SignVideoUploadUseCase, { provide: VIDEO_STORAGE_PORT, useValue: mockStorage }],
    }).compile();

    useCase = module.get(SignVideoUploadUseCase);
  });

  it('throws BadRequestException for an invalid contentType', async () => {
    await expect(
      useCase.execute({ clinicId: CLINIC_ID, contentType: 'video/x-msvideo' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockStorage.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('builds correct path with .mp4 extension for video/mp4', async () => {
    await useCase.execute({ clinicId: CLINIC_ID, contentType: 'video/mp4' });
    const [[path]] = mockStorage.createSignedUploadUrl.mock.calls;
    expect(path).toMatch(/^videos\/clinic-123\/[0-9a-f-]+\.mp4$/);
  });

  it('builds correct path with .webm extension for video/webm', async () => {
    await useCase.execute({ clinicId: CLINIC_ID, contentType: 'video/webm' });
    const [[path]] = mockStorage.createSignedUploadUrl.mock.calls;
    expect(path).toMatch(/^videos\/clinic-123\/[0-9a-f-]+\.webm$/);
  });

  it('builds correct path with .mov extension for video/quicktime', async () => {
    await useCase.execute({ clinicId: CLINIC_ID, contentType: 'video/quicktime' });
    const [[path]] = mockStorage.createSignedUploadUrl.mock.calls;
    expect(path).toMatch(/^videos\/clinic-123\/[0-9a-f-]+\.mov$/);
  });

  it('calls storage.createSignedUploadUrl with the generated path', async () => {
    await useCase.execute({ clinicId: CLINIC_ID, contentType: 'video/mp4' });
    expect(mockStorage.createSignedUploadUrl).toHaveBeenCalledTimes(1);
    const [[path]] = mockStorage.createSignedUploadUrl.mock.calls;
    expect(typeof path).toBe('string');
    expect(path.startsWith(`videos/${CLINIC_ID}/`)).toBe(true);
  });

  it('returns { uploadUrl, token, path }', async () => {
    const result = await useCase.execute({ clinicId: CLINIC_ID, contentType: 'video/mp4' });
    expect(result.uploadUrl).toBe('https://storage.test/signed-url');
    expect(result.token).toBe('test-token');
    expect(result.path).toMatch(/^videos\/clinic-123\//);
  });
});

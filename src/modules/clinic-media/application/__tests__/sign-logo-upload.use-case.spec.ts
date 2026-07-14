import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SignLogoUploadUseCase } from '../sign-logo-upload.use-case';
import { STORAGE_PORT } from '../../domain/ports/storage.port';
import type { StoragePort } from '../../domain/ports/storage.port';

const CLINIC_ID = 'clinic-123';

describe('SignLogoUploadUseCase', () => {
  let useCase: SignLogoUploadUseCase;
  let mockStorage: jest.Mocked<StoragePort>;

  beforeEach(async () => {
    mockStorage = {
      createSignedUploadUrl: jest.fn().mockResolvedValue({
        uploadUrl: 'https://storage.test/signed-url',
        token: 'test-token',
      }),
      publicUrl: jest.fn().mockReturnValue('https://storage.test/public'),
      remove: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [SignLogoUploadUseCase, { provide: STORAGE_PORT, useValue: mockStorage }],
    }).compile();

    useCase = module.get(SignLogoUploadUseCase);
  });

  it('throws BadRequestException for an invalid contentType', async () => {
    await expect(
      useCase.execute({ clinicId: CLINIC_ID, contentType: 'image/gif' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockStorage.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('builds correct path with .png extension for image/png', async () => {
    await useCase.execute({ clinicId: CLINIC_ID, contentType: 'image/png' });
    const [[path]] = mockStorage.createSignedUploadUrl.mock.calls;
    expect(path).toMatch(/^logos\/clinic-123\/[0-9a-f-]+\.png$/);
  });

  it('builds correct path with .jpg extension for image/jpeg', async () => {
    await useCase.execute({ clinicId: CLINIC_ID, contentType: 'image/jpeg' });
    const [[path]] = mockStorage.createSignedUploadUrl.mock.calls;
    expect(path).toMatch(/^logos\/clinic-123\/[0-9a-f-]+\.jpg$/);
  });

  it('builds correct path with .webp extension for image/webp', async () => {
    await useCase.execute({ clinicId: CLINIC_ID, contentType: 'image/webp' });
    const [[path]] = mockStorage.createSignedUploadUrl.mock.calls;
    expect(path).toMatch(/^logos\/clinic-123\/[0-9a-f-]+\.webp$/);
  });

  it('calls storage.createSignedUploadUrl with the generated path', async () => {
    await useCase.execute({ clinicId: CLINIC_ID, contentType: 'image/png' });
    expect(mockStorage.createSignedUploadUrl).toHaveBeenCalledTimes(1);
    const [[path]] = mockStorage.createSignedUploadUrl.mock.calls;
    expect(typeof path).toBe('string');
    expect(path.startsWith(`logos/${CLINIC_ID}/`)).toBe(true);
  });

  it('returns { uploadUrl, token, path }', async () => {
    const result = await useCase.execute({ clinicId: CLINIC_ID, contentType: 'image/png' });
    expect(result.uploadUrl).toBe('https://storage.test/signed-url');
    expect(result.token).toBe('test-token');
    expect(result.path).toMatch(/^logos\/clinic-123\//);
  });
});

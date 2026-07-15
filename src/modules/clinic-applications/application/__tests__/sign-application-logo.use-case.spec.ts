import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SignApplicationLogoUseCase } from '../sign-application-logo.use-case';
import { STORAGE_PORT } from '../../../clinic-media/domain/ports/storage.port';
import type { StoragePort } from '../../../clinic-media/domain/ports/storage.port';

describe('SignApplicationLogoUseCase', () => {
  let useCase: SignApplicationLogoUseCase;
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
      providers: [SignApplicationLogoUseCase, { provide: STORAGE_PORT, useValue: mockStorage }],
    }).compile();

    useCase = module.get(SignApplicationLogoUseCase);
  });

  it('throws BadRequestException for an invalid contentType', async () => {
    await expect(useCase.execute({ contentType: 'image/gif' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mockStorage.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('throws BadRequestException for image/bmp', async () => {
    await expect(useCase.execute({ contentType: 'image/bmp' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('builds correct path starting with applications/ and ending in .png for image/png', async () => {
    await useCase.execute({ contentType: 'image/png' });
    const [[path]] = mockStorage.createSignedUploadUrl.mock.calls;
    expect(path).toMatch(/^applications\/[0-9a-f-]+\/logo\.png$/);
  });

  it('builds correct path starting with applications/ and ending in .jpg for image/jpeg', async () => {
    await useCase.execute({ contentType: 'image/jpeg' });
    const [[path]] = mockStorage.createSignedUploadUrl.mock.calls;
    expect(path).toMatch(/^applications\/[0-9a-f-]+\/logo\.jpg$/);
  });

  it('builds correct path starting with applications/ and ending in .webp for image/webp', async () => {
    await useCase.execute({ contentType: 'image/webp' });
    const [[path]] = mockStorage.createSignedUploadUrl.mock.calls;
    expect(path).toMatch(/^applications\/[0-9a-f-]+\/logo\.webp$/);
  });

  it('calls storage.createSignedUploadUrl with a path starting applications/', async () => {
    await useCase.execute({ contentType: 'image/png' });
    expect(mockStorage.createSignedUploadUrl).toHaveBeenCalledTimes(1);
    const [[path]] = mockStorage.createSignedUploadUrl.mock.calls;
    expect(path.startsWith('applications/')).toBe(true);
  });

  it('returns { uploadUrl, token, path }', async () => {
    const result = await useCase.execute({ contentType: 'image/png' });
    expect(result.uploadUrl).toBe('https://storage.test/signed-url');
    expect(result.token).toBe('test-token');
    expect(result.path).toMatch(/^applications\//);
  });

  it('path prefix is server-generated (each call produces a different UUID)', async () => {
    await useCase.execute({ contentType: 'image/png' });
    await useCase.execute({ contentType: 'image/png' });
    const calls = mockStorage.createSignedUploadUrl.mock.calls;
    expect(calls[0]![0]).not.toBe(calls[1]![0]);
  });
});

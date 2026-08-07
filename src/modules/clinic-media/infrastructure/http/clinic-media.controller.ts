import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClinicGuard } from '../../../../infrastructure/security/clinic.guard';
import { CurrentClinic } from '../../../../infrastructure/security/current-clinic.decorator';
import { SignLogoUploadUseCase } from '../../application/sign-logo-upload.use-case';
import { SignPhotoUploadsUseCase } from '../../application/sign-photo-uploads.use-case';
import { SignVideoUploadUseCase } from '../../application/sign-video-upload.use-case';
import { ConfirmLogoUseCase } from '../../application/confirm-logo.use-case';
import { ConfirmPhotosUseCase } from '../../application/confirm-photos.use-case';
import { ConfirmVideoUseCase } from '../../application/confirm-video.use-case';
import { ListPhotosUseCase } from '../../application/list-photos.use-case';
import { SignLogoUploadDto } from './dto/sign-logo-upload.dto';
import { SignPhotoUploadsDto } from './dto/sign-photo-uploads.dto';
import { SignVideoUploadDto } from './dto/sign-video-upload.dto';
import { ConfirmLogoDto } from './dto/confirm-logo.dto';
import { ConfirmPhotosDto } from './dto/confirm-photos.dto';
import { ConfirmVideoDto } from './dto/confirm-video.dto';
import type { SignLogoUploadResult } from '../../application/sign-logo-upload.use-case';
import type { SignPhotoUploadsResult } from '../../application/sign-photo-uploads.use-case';
import type { SignVideoUploadResult } from '../../application/sign-video-upload.use-case';
import type { ConfirmLogoResult } from '../../application/confirm-logo.use-case';
import type { ConfirmPhotosResult } from '../../application/confirm-photos.use-case';
import type { ConfirmVideoResult } from '../../application/confirm-video.use-case';

@ApiTags('Clinic Media')
@ApiCookieAuth()
@Controller('clinic/portal/media')
@UseGuards(ClinicGuard)
export class ClinicMediaController {
  constructor(
    private readonly signLogoUpload: SignLogoUploadUseCase,
    private readonly signPhotoUploads: SignPhotoUploadsUseCase,
    private readonly signVideoUpload: SignVideoUploadUseCase,
    private readonly confirmLogo: ConfirmLogoUseCase,
    private readonly confirmPhotos: ConfirmPhotosUseCase,
    private readonly confirmVideo: ConfirmVideoUseCase,
    private readonly listPhotos: ListPhotosUseCase,
  ) {}

  @ApiOperation({ summary: 'Get a signed upload URL for a clinic logo' })
  @Post('logo/sign')
  @HttpCode(HttpStatus.OK)
  async signLogo(
    @CurrentClinic() clinicId: string,
    @Body() dto: SignLogoUploadDto,
  ): Promise<SignLogoUploadResult> {
    return this.signLogoUpload.execute({ clinicId, contentType: dto.contentType });
  }

  @ApiOperation({ summary: 'Get signed upload URLs for clinic photos' })
  @Post('photos/sign')
  @HttpCode(HttpStatus.OK)
  async signPhotos(
    @CurrentClinic() clinicId: string,
    @Body() dto: SignPhotoUploadsDto,
  ): Promise<SignPhotoUploadsResult> {
    return this.signPhotoUploads.execute({ clinicId, count: dto.count });
  }

  @ApiOperation({ summary: 'Confirm a clinic logo after upload' })
  @Post('logo')
  @HttpCode(HttpStatus.OK)
  async confirmLogoUpload(
    @CurrentClinic() clinicId: string,
    @Body() dto: ConfirmLogoDto,
  ): Promise<ConfirmLogoResult> {
    return this.confirmLogo.execute({ clinicId, path: dto.path });
  }

  @ApiOperation({ summary: 'Confirm clinic photos after upload' })
  @Post('photos')
  @HttpCode(HttpStatus.OK)
  async confirmPhotosUpload(
    @CurrentClinic() clinicId: string,
    @Body() dto: ConfirmPhotosDto,
  ): Promise<ConfirmPhotosResult> {
    return this.confirmPhotos.execute({ clinicId, paths: dto.paths });
  }

  @ApiOperation({ summary: 'List clinic photos' })
  @Get('photos')
  async getPhotos(@CurrentClinic() clinicId: string): Promise<string[]> {
    return this.listPhotos.execute({ clinicId });
  }

  @ApiOperation({ summary: 'Get a signed upload URL for a clinic tour video' })
  @Post('video/sign')
  @HttpCode(HttpStatus.OK)
  async signVideo(
    @CurrentClinic() clinicId: string,
    @Body() dto: SignVideoUploadDto,
  ): Promise<SignVideoUploadResult> {
    return this.signVideoUpload.execute({ clinicId, contentType: dto.contentType });
  }

  @ApiOperation({ summary: 'Confirm a clinic tour video after upload' })
  @Post('video')
  @HttpCode(HttpStatus.OK)
  async confirmVideoUpload(
    @CurrentClinic() clinicId: string,
    @Body() dto: ConfirmVideoDto,
  ): Promise<ConfirmVideoResult> {
    return this.confirmVideo.execute({ clinicId, path: dto.path });
  }
}

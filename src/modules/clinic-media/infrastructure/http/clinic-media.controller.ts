import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClinicGuard } from '../../../../infrastructure/security/clinic.guard';
import { CurrentClinic } from '../../../../infrastructure/security/current-clinic.decorator';
import { SignLogoUploadUseCase } from '../../application/sign-logo-upload.use-case';
import { SignPhotoUploadsUseCase } from '../../application/sign-photo-uploads.use-case';
import { SignLogoUploadDto } from './dto/sign-logo-upload.dto';
import { SignPhotoUploadsDto } from './dto/sign-photo-uploads.dto';
import type { SignLogoUploadResult } from '../../application/sign-logo-upload.use-case';
import type { SignPhotoUploadsResult } from '../../application/sign-photo-uploads.use-case';

@ApiTags('Clinic Media')
@ApiCookieAuth()
@Controller('clinic/portal/media')
@UseGuards(ClinicGuard)
export class ClinicMediaController {
  constructor(
    private readonly signLogoUpload: SignLogoUploadUseCase,
    private readonly signPhotoUploads: SignPhotoUploadsUseCase,
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
}

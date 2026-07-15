import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../../infrastructure/security/public.decorator';
import { SignApplicationLogoUseCase } from '../../application/sign-application-logo.use-case';
import { SignApplicationPhotosUseCase } from '../../application/sign-application-photos.use-case';
import { SubmitApplicationUseCase } from '../../application/submit-application.use-case';
import { SignApplicationLogoDto } from './dto/sign-application-logo.dto';
import { SignApplicationPhotosDto } from './dto/sign-application-photos.dto';
import { SubmitApplicationDto } from './dto/submit-application.dto';
import type { SignApplicationLogoResult } from '../../application/sign-application-logo.use-case';
import type { SignApplicationPhotosResult } from '../../application/sign-application-photos.use-case';
import type { SubmitApplicationResult } from '../../application/submit-application.use-case';

@ApiTags('Clinic Applications')
@Controller('clinic-applications')
export class ClinicApplicationsController {
  constructor(
    private readonly signApplicationLogo: SignApplicationLogoUseCase,
    private readonly signApplicationPhotos: SignApplicationPhotosUseCase,
    private readonly submitApplication: SubmitApplicationUseCase,
  ) {}

  @ApiOperation({ summary: 'Submit a clinic application' })
  @Public()
  @Post()
  async submit(@Body() dto: SubmitApplicationDto): Promise<SubmitApplicationResult> {
    return this.submitApplication.execute(dto);
  }

  @ApiOperation({ summary: 'Get a signed upload URL for an application logo' })
  @Public()
  @Post('media/logo/sign')
  @HttpCode(HttpStatus.OK)
  async signLogo(@Body() dto: SignApplicationLogoDto): Promise<SignApplicationLogoResult> {
    return this.signApplicationLogo.execute({ contentType: dto.contentType });
  }

  @ApiOperation({ summary: 'Get signed upload URLs for application photos' })
  @Public()
  @Post('media/photos/sign')
  @HttpCode(HttpStatus.OK)
  async signPhotos(@Body() dto: SignApplicationPhotosDto): Promise<SignApplicationPhotosResult> {
    return this.signApplicationPhotos.execute({ count: dto.count });
  }
}

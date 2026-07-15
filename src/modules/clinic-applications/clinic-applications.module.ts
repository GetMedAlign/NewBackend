import { Module } from '@nestjs/common';
import { ClinicMediaModule } from '../clinic-media/clinic-media.module';
import { SignApplicationLogoUseCase } from './application/sign-application-logo.use-case';
import { SignApplicationPhotosUseCase } from './application/sign-application-photos.use-case';
import { ClinicApplicationsController } from './infrastructure/http/clinic-applications.controller';

@Module({
  imports: [ClinicMediaModule],
  controllers: [ClinicApplicationsController],
  providers: [SignApplicationLogoUseCase, SignApplicationPhotosUseCase],
})
export class ClinicApplicationsModule {}

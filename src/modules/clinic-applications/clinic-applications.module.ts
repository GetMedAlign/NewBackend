import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { ClinicMediaModule } from '../clinic-media/clinic-media.module';
import { SignApplicationLogoUseCase } from './application/sign-application-logo.use-case';
import { SignApplicationPhotosUseCase } from './application/sign-application-photos.use-case';
import { SubmitApplicationUseCase } from './application/submit-application.use-case';
import { ListApplicationsUseCase } from './application/list-applications.use-case';
import { GetApplicationUseCase } from './application/get-application.use-case';
import { APPLICATION_REPOSITORY } from './domain/ports/application-repository.port';
import { PrismaApplicationRepository } from './infrastructure/prisma-application.repository';
import { ClinicApplicationsController } from './infrastructure/http/clinic-applications.controller';
import { AdminApplicationsController } from './infrastructure/http/admin-applications.controller';

@Module({
  imports: [ClinicMediaModule, PrismaModule],
  controllers: [ClinicApplicationsController, AdminApplicationsController],
  providers: [
    SignApplicationLogoUseCase,
    SignApplicationPhotosUseCase,
    SubmitApplicationUseCase,
    ListApplicationsUseCase,
    GetApplicationUseCase,
    { provide: APPLICATION_REPOSITORY, useClass: PrismaApplicationRepository },
  ],
})
export class ClinicApplicationsModule {}

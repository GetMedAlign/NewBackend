import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { ClinicMediaModule } from '../clinic-media/clinic-media.module';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { SignApplicationLogoUseCase } from './application/sign-application-logo.use-case';
import { SignApplicationPhotosUseCase } from './application/sign-application-photos.use-case';
import { SubmitApplicationUseCase } from './application/submit-application.use-case';
import { ListApplicationsUseCase } from './application/list-applications.use-case';
import { GetApplicationUseCase } from './application/get-application.use-case';
import { ReviewApplicationUseCase } from './application/review-application.use-case';
import { APPLICATION_REPOSITORY } from './domain/ports/application-repository.port';
import { PrismaApplicationRepository } from './infrastructure/prisma-application.repository';
import { ClinicApplicationsController } from './infrastructure/http/clinic-applications.controller';
import { AdminApplicationsController } from './infrastructure/http/admin-applications.controller';

@Module({
  imports: [ClinicMediaModule, PrismaModule, ConfigModule, AuthModule, BillingModule],
  controllers: [ClinicApplicationsController, AdminApplicationsController],
  providers: [
    SignApplicationLogoUseCase,
    SignApplicationPhotosUseCase,
    SubmitApplicationUseCase,
    ListApplicationsUseCase,
    GetApplicationUseCase,
    ReviewApplicationUseCase,
    { provide: APPLICATION_REPOSITORY, useClass: PrismaApplicationRepository },
  ],
})
export class ClinicApplicationsModule {}

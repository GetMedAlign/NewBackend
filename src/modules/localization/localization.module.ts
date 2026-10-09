import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { LOCALIZATION_REPOSITORY } from './domain/ports/localization-repository.port';
import { PrismaLocalizationRepository } from './infrastructure/prisma-localization.repository';
import { CoverageService } from './domain/coverage.service';
import { LocalizationController } from './infrastructure/http/localization.controller';
import { GetCitiesUseCase } from './application/get-cities.use-case';
import { GetCityUseCase } from './application/get-city.use-case';
import { GetServicesUseCase } from './application/get-services.use-case';
import { GetServiceUseCase } from './application/get-service.use-case';
import { GetComboUseCase } from './application/get-combo.use-case';
import { GetCoverageUseCase } from './application/get-coverage.use-case';
import { CaptureNotifyUseCase } from './application/capture-notify.use-case';

@Module({
  imports: [PrismaModule],
  controllers: [LocalizationController],
  providers: [
    { provide: LOCALIZATION_REPOSITORY, useClass: PrismaLocalizationRepository },
    CoverageService,
    GetCitiesUseCase,
    GetCityUseCase,
    GetServicesUseCase,
    GetServiceUseCase,
    GetComboUseCase,
    GetCoverageUseCase,
    CaptureNotifyUseCase,
  ],
  exports: [LOCALIZATION_REPOSITORY, CoverageService],
})
export class LocalizationModule {}

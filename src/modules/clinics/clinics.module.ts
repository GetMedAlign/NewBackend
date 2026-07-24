import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { GeoModule } from '../../infrastructure/geo/geo.module';
import { CLINIC_REPOSITORY } from './domain/ports/clinic-repository.port';
import { PrismaClinicRepository } from './infrastructure/prisma-clinic.repository';
import { ClinicsController } from './infrastructure/http/clinics.controller';
import { GetClinicDirectoryUseCase } from './application/get-clinic-directory.use-case';
import { GetClinicProfileUseCase } from './application/get-clinic-profile.use-case';

@Module({
  imports: [PrismaModule, GeoModule],
  controllers: [ClinicsController],
  providers: [
    {
      provide: CLINIC_REPOSITORY,
      useClass: PrismaClinicRepository,
    },
    GetClinicDirectoryUseCase,
    GetClinicProfileUseCase,
  ],
  exports: [CLINIC_REPOSITORY],
})
export class ClinicsModule {}

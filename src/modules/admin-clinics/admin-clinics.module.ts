import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { GetClinicUseCase } from './application/get-clinic.use-case';
import { ListClinicsUseCase } from './application/list-clinics.use-case';
import { UpdateClinicUseCase } from './application/update-clinic.use-case';
import { PauseDeliveryUseCase } from './application/pause-delivery.use-case';
import { ADMIN_CLINIC_REPOSITORY } from './domain/ports/admin-clinic-repository.port';
import { PrismaAdminClinicRepository } from './infrastructure/prisma-admin-clinic.repository';
import { AdminClinicsController } from './infrastructure/http/admin-clinics.controller';

@Module({
  imports: [PrismaModule],
  controllers: [AdminClinicsController],
  providers: [
    ListClinicsUseCase,
    GetClinicUseCase,
    UpdateClinicUseCase,
    PauseDeliveryUseCase,
    { provide: ADMIN_CLINIC_REPOSITORY, useClass: PrismaAdminClinicRepository },
  ],
})
export class AdminClinicsModule {}

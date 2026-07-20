import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { GetClinicUseCase } from './application/get-clinic.use-case';
import { ListClinicsUseCase } from './application/list-clinics.use-case';
import { ADMIN_CLINIC_REPOSITORY } from './domain/ports/admin-clinic-repository.port';
import { PrismaAdminClinicRepository } from './infrastructure/prisma-admin-clinic.repository';
import { AdminClinicsController } from './infrastructure/http/admin-clinics.controller';

@Module({
  imports: [PrismaModule],
  controllers: [AdminClinicsController],
  providers: [
    ListClinicsUseCase,
    GetClinicUseCase,
    { provide: ADMIN_CLINIC_REPOSITORY, useClass: PrismaAdminClinicRepository },
  ],
})
export class AdminClinicsModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ListPatientsUseCase } from './application/list-patients.use-case';
import { GetPatientUseCase } from './application/get-patient.use-case';
import { ADMIN_PATIENT_REPOSITORY } from './domain/ports/admin-patient-repository.port';
import { PrismaAdminPatientRepository } from './infrastructure/prisma-admin-patient.repository';
import { AdminPatientsController } from './infrastructure/http/admin-patients.controller';
import { PhiAccessInterceptor } from './infrastructure/http/phi-access.interceptor';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AdminPatientsController],
  providers: [
    ListPatientsUseCase,
    GetPatientUseCase,
    PhiAccessInterceptor,
    { provide: ADMIN_PATIENT_REPOSITORY, useClass: PrismaAdminPatientRepository },
  ],
})
export class AdminPatientsModule {}

import { Module } from '@nestjs/common';

import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { LeadsModule } from '../leads/leads.module';

import { PATIENT_REPOSITORY } from './domain/ports/patient-repository.port';
import { PrismaPatientRepository } from './infrastructure/prisma-patient.repository';
import { GetProfileUseCase } from './application/get-profile.use-case';
import { UpdateProfileUseCase } from './application/update-profile.use-case';
import { GetMyLeadsUseCase } from './application/get-my-leads.use-case';
import { PatientsController } from './infrastructure/http/patients.controller';

@Module({
  imports: [PrismaModule, LeadsModule],
  controllers: [PatientsController],
  providers: [
    GetProfileUseCase,
    UpdateProfileUseCase,
    GetMyLeadsUseCase,
    {
      provide: PATIENT_REPOSITORY,
      useClass: PrismaPatientRepository,
    },
  ],
})
export class PatientsModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { CLINIC_WRITE_REPOSITORY } from './domain/ports/clinic-write-repository.port';
import { CLINIC_LEAD_REPOSITORY } from './domain/ports/clinic-lead-repository.port';
import { PrismaClinicWriteRepository } from './infrastructure/prisma-clinic-write.repository';
import { PrismaClinicLeadRepository } from './infrastructure/prisma-clinic-lead.repository';
import { GetClinicProfileUseCase } from './application/get-clinic-profile.use-case';
import { UpdateClinicProfileUseCase } from './application/update-clinic-profile.use-case';
import { ListClinicLeadsUseCase } from './application/list-clinic-leads.use-case';
import { GetClinicLeadUseCase } from './application/get-clinic-lead.use-case';
import { UpdateLeadStatusUseCase } from './application/update-lead-status.use-case';
import { RequestPatientContactUseCase } from './application/request-patient-contact.use-case';
import { ClinicPortalController } from './infrastructure/http/clinic-portal.controller';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ClinicPortalController],
  providers: [
    GetClinicProfileUseCase,
    UpdateClinicProfileUseCase,
    ListClinicLeadsUseCase,
    GetClinicLeadUseCase,
    UpdateLeadStatusUseCase,
    RequestPatientContactUseCase,
    {
      provide: CLINIC_WRITE_REPOSITORY,
      useClass: PrismaClinicWriteRepository,
    },
    {
      provide: CLINIC_LEAD_REPOSITORY,
      useClass: PrismaClinicLeadRepository,
    },
  ],
})
export class ClinicPortalModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { CLINIC_WRITE_REPOSITORY } from './domain/ports/clinic-write-repository.port';
import { PrismaClinicWriteRepository } from './infrastructure/prisma-clinic-write.repository';
import { GetClinicProfileUseCase } from './application/get-clinic-profile.use-case';
import { UpdateClinicProfileUseCase } from './application/update-clinic-profile.use-case';
import { ClinicPortalController } from './infrastructure/http/clinic-portal.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ClinicPortalController],
  providers: [
    GetClinicProfileUseCase,
    UpdateClinicProfileUseCase,
    {
      provide: CLINIC_WRITE_REPOSITORY,
      useClass: PrismaClinicWriteRepository,
    },
  ],
})
export class ClinicPortalModule {}

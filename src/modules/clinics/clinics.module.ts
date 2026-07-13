import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { CLINIC_REPOSITORY } from './domain/ports/clinic-repository.port';
import { PrismaClinicRepository } from './infrastructure/prisma-clinic.repository';

@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: CLINIC_REPOSITORY,
      useClass: PrismaClinicRepository,
    },
  ],
  exports: [CLINIC_REPOSITORY],
})
export class ClinicsModule {}

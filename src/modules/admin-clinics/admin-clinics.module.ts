import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { GetClinicUseCase } from './application/get-clinic.use-case';
import { ListClinicsUseCase } from './application/list-clinics.use-case';
import { UpdateClinicUseCase } from './application/update-clinic.use-case';
import { PauseDeliveryUseCase } from './application/pause-delivery.use-case';
import { ListClinicLeadsUseCase } from './application/list-clinic-leads.use-case';
import { ListNotesUseCase } from './application/list-notes.use-case';
import { AddNoteUseCase } from './application/add-note.use-case';
import { ADMIN_CLINIC_REPOSITORY } from './domain/ports/admin-clinic-repository.port';
import { ADMIN_NOTE_REPOSITORY } from './domain/ports/admin-note-repository.port';
import { PrismaAdminClinicRepository } from './infrastructure/prisma-admin-clinic.repository';
import { PrismaAdminNoteRepository } from './infrastructure/prisma-admin-note.repository';
import { AdminClinicsController } from './infrastructure/http/admin-clinics.controller';

@Module({
  imports: [PrismaModule],
  controllers: [AdminClinicsController],
  providers: [
    ListClinicsUseCase,
    GetClinicUseCase,
    UpdateClinicUseCase,
    PauseDeliveryUseCase,
    ListClinicLeadsUseCase,
    ListNotesUseCase,
    AddNoteUseCase,
    { provide: ADMIN_CLINIC_REPOSITORY, useClass: PrismaAdminClinicRepository },
    { provide: ADMIN_NOTE_REPOSITORY, useClass: PrismaAdminNoteRepository },
  ],
})
export class AdminClinicsModule {}

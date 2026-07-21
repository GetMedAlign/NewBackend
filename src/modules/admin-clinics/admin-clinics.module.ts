import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { GetClinicUseCase } from './application/get-clinic.use-case';
import { ListClinicsUseCase } from './application/list-clinics.use-case';
import { UpdateClinicUseCase } from './application/update-clinic.use-case';
import { PauseDeliveryUseCase } from './application/pause-delivery.use-case';
import { ListClinicLeadsUseCase } from './application/list-clinic-leads.use-case';
import { ListNotesUseCase } from './application/list-notes.use-case';
import { AddNoteUseCase } from './application/add-note.use-case';
import { SendClinicPasswordResetUseCase } from './application/send-clinic-password-reset.use-case';
import { SetClinicPasswordUseCase } from './application/set-clinic-password.use-case';
import { ADMIN_CLINIC_REPOSITORY } from './domain/ports/admin-clinic-repository.port';
import { ADMIN_NOTE_REPOSITORY } from './domain/ports/admin-note-repository.port';
import { PrismaAdminClinicRepository } from './infrastructure/prisma-admin-clinic.repository';
import { PrismaAdminNoteRepository } from './infrastructure/prisma-admin-note.repository';
import { AdminClinicsController } from './infrastructure/http/admin-clinics.controller';

@Module({
  imports: [PrismaModule, AuthModule, BillingModule],
  controllers: [AdminClinicsController],
  providers: [
    ListClinicsUseCase,
    GetClinicUseCase,
    UpdateClinicUseCase,
    PauseDeliveryUseCase,
    ListClinicLeadsUseCase,
    ListNotesUseCase,
    AddNoteUseCase,
    SendClinicPasswordResetUseCase,
    SetClinicPasswordUseCase,
    { provide: ADMIN_CLINIC_REPOSITORY, useClass: PrismaAdminClinicRepository },
    { provide: ADMIN_NOTE_REPOSITORY, useClass: PrismaAdminNoteRepository },
  ],
})
export class AdminClinicsModule {}

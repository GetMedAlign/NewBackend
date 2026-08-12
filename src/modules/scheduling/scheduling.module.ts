import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { CryptoModule } from '../../infrastructure/crypto/crypto.module';
import { LeadsModule } from '../leads/leads.module';
import { PatientsModule } from '../patients/patients.module';
import { CALENDLY_PORT } from './domain/ports/calendly.port';
import { CalendlyHttpAdapter } from './infrastructure/calendly.adapter';
import { CALENDLY_WEBHOOK_VERIFIER } from './domain/ports/calendly-webhook-verifier.port';
import { CalendlyWebhookVerifierAdapter } from './infrastructure/calendly-webhook-verifier.adapter';
import { SCHEDULING_REPOSITORY } from './domain/ports/scheduling-repository.port';
import { PrismaSchedulingRepository } from './infrastructure/prisma-scheduling.repository';
import { APPOINTMENT_REPOSITORY } from './domain/ports/appointment-repository.port';
import { PrismaAppointmentRepository } from './infrastructure/prisma-appointment.repository';
import { GetSchedulingStatusUseCase } from './application/get-scheduling-status.use-case';
import { ConnectAuthorizeUrlUseCase } from './application/connect-authorize-url.use-case';
import { CalendlyCallbackUseCase } from './application/calendly-callback.use-case';
import { DisconnectSchedulingUseCase } from './application/disconnect-scheduling.use-case';
import { HandleCalendlyWebhookUseCase } from './application/handle-calendly-webhook.use-case';
import { ListClinicAppointmentsUseCase } from './application/list-clinic-appointments.use-case';
import { ListPatientAppointmentsUseCase } from './application/list-patient-appointments.use-case';
import { SchedulingController } from './infrastructure/http/scheduling.controller';
import { CalendlyWebhookController } from './infrastructure/http/calendly-webhook.controller';
import { PatientAppointmentsController } from './infrastructure/http/patient-appointments.controller';

@Module({
  imports: [ConfigModule, PrismaModule, CryptoModule, LeadsModule, PatientsModule],
  controllers: [SchedulingController, CalendlyWebhookController, PatientAppointmentsController],
  providers: [
    {
      provide: CALENDLY_PORT,
      useClass: CalendlyHttpAdapter,
    },
    {
      provide: CALENDLY_WEBHOOK_VERIFIER,
      useClass: CalendlyWebhookVerifierAdapter,
    },
    {
      provide: SCHEDULING_REPOSITORY,
      useClass: PrismaSchedulingRepository,
    },
    {
      provide: APPOINTMENT_REPOSITORY,
      useClass: PrismaAppointmentRepository,
    },
    GetSchedulingStatusUseCase,
    ConnectAuthorizeUrlUseCase,
    CalendlyCallbackUseCase,
    DisconnectSchedulingUseCase,
    HandleCalendlyWebhookUseCase,
    ListClinicAppointmentsUseCase,
    ListPatientAppointmentsUseCase,
  ],
  exports: [CALENDLY_PORT, CALENDLY_WEBHOOK_VERIFIER, APPOINTMENT_REPOSITORY],
})
export class SchedulingModule {}

import { Inject, Injectable } from '@nestjs/common';
import { APPOINTMENT_REPOSITORY } from '../domain/ports/appointment-repository.port';
import type { AppointmentRepositoryPort } from '../domain/ports/appointment-repository.port';
import { AppointmentDto } from '../infrastructure/http/dto/appointment.dto';
import { toAppointmentDto } from './list-clinic-appointments.use-case';

/**
 * Lists all appointments linked to a patient, scoped strictly to the
 * caller's own `patientId` (and, for anonymous pre-claim bookings, their
 * assessment `sessionId`). Callers must resolve both from the authenticated
 * session before invoking this use case; it never widens the scope itself.
 */
@Injectable()
export class ListPatientAppointmentsUseCase {
  constructor(
    @Inject(APPOINTMENT_REPOSITORY)
    private readonly appointmentRepository: AppointmentRepositoryPort,
  ) {}

  async execute(params: { patientId: string; sessionId: string }): Promise<AppointmentDto[]> {
    const rows = await this.appointmentRepository.listForPatient(params);
    return rows.map(toAppointmentDto);
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { APPOINTMENT_REPOSITORY } from '../domain/ports/appointment-repository.port';
import type {
  AppointmentRecord,
  AppointmentRepositoryPort,
} from '../domain/ports/appointment-repository.port';
import { AppointmentDto } from '../infrastructure/http/dto/appointment.dto';

/** Lists all appointments for the authenticated clinic (clinic portal). */
@Injectable()
export class ListClinicAppointmentsUseCase {
  constructor(
    @Inject(APPOINTMENT_REPOSITORY) private readonly appointmentRepository: AppointmentRepositoryPort,
  ) {}

  async execute(clinicId: string): Promise<AppointmentDto[]> {
    const rows = await this.appointmentRepository.listForClinic(clinicId);
    return rows.map(toAppointmentDto);
  }
}

export function toAppointmentDto(row: AppointmentRecord): AppointmentDto {
  return {
    id: row.id,
    status: row.status,
    startTime: row.startTime.toISOString(),
    endTime: row.endTime ? row.endTime.toISOString() : null,
    inviteeName: row.inviteeName,
    inviteeEmail: row.inviteeEmail,
    clinicId: row.clinicId,
    clinicName: row.clinicName,
    leadId: row.leadId,
  };
}

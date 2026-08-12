import { ApiProperty } from '@nestjs/swagger';
import type { AppointmentStatus } from '../../../domain/ports/appointment-repository.port';

/**
 * Client-safe appointment read model. Never includes the Calendly access
 * token, webhook signing key, or any ciphertext: only fields safe to show
 * in the clinic portal or the patient's own appointment list.
 */
export class AppointmentDto {
  @ApiProperty({ description: 'Appointment id' })
  id!: string;

  @ApiProperty({ enum: ['booked', 'canceled'], description: 'Appointment status' })
  status!: AppointmentStatus;

  @ApiProperty({ description: 'Appointment start time (ISO 8601)' })
  startTime!: string;

  @ApiProperty({ type: String, nullable: true, description: 'Appointment end time (ISO 8601)' })
  endTime!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Name given at booking' })
  inviteeName!: string | null;

  @ApiProperty({ description: 'Email given at booking' })
  inviteeEmail!: string;

  @ApiProperty({ description: 'Clinic id' })
  clinicId!: string;

  @ApiProperty({ description: 'Clinic name' })
  clinicName!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "The linked lead's public id, or null if the appointment could not be linked to a lead",
  })
  leadId!: string | null;
}

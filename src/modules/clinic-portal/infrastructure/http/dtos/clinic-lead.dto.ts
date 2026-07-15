import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';
import type { ClinicLeadView } from '../../../domain/ports/clinic-lead-repository.port';

export class PatientDto {
  @ApiProperty()
  first_name!: string;

  @ApiProperty()
  email!: string;

  @ApiPropertyOptional({ nullable: true })
  zip_code!: string | null;
}

export class AssessmentSummaryDto {
  @ApiProperty()
  treatmentCategory!: string;

  @ApiProperty({ type: [String] })
  topGoals!: string[];

  @ApiProperty({ type: [String] })
  topSymptoms!: string[];

  @ApiPropertyOptional({ nullable: true })
  budgetBand!: string | null;

  @ApiPropertyOptional({ nullable: true })
  telehealthPreference!: string | null;

  @ApiPropertyOptional({ nullable: true })
  startTimeline!: string | null;
}

export class ClinicLeadDto {
  @ApiProperty()
  lead_id!: string;

  @ApiProperty({ description: 'ISO-8601 timestamp' })
  received_at!: string;

  @ApiProperty()
  lead_source!: string;

  @ApiProperty({ type: PatientDto })
  patient!: PatientDto;

  @ApiProperty({ type: AssessmentSummaryDto })
  assessment_summary!: AssessmentSummaryDto;

  @ApiProperty()
  delivery_status!: string;

  @ApiProperty()
  clinic_status!: string;
}

export const VALID_CLINIC_STATUSES = [
  'new',
  'contacted',
  'booked',
  'converted',
  'not_interested',
] as const;

export type ClinicLeadStatus = (typeof VALID_CLINIC_STATUSES)[number];

export class UpdateLeadStatusDto {
  @ApiProperty({ enum: VALID_CLINIC_STATUSES })
  @IsString()
  @IsIn(VALID_CLINIC_STATUSES, {
    message: `status must be one of: ${VALID_CLINIC_STATUSES.join(', ')}`,
  })
  status!: string;
}

function splitCommaString(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function toClinicLeadDto(lead: ClinicLeadView): ClinicLeadDto {
  const patient = new PatientDto();
  patient.first_name = lead.patientFirstName;
  patient.email = lead.patientEmail;
  patient.zip_code = lead.patientZip ?? null;

  const summary = new AssessmentSummaryDto();
  summary.treatmentCategory = lead.treatmentCategory;
  summary.topGoals = splitCommaString(lead.topGoals);
  summary.topSymptoms = splitCommaString(lead.topSymptoms);
  summary.budgetBand = lead.budgetBand ?? null;
  summary.telehealthPreference = lead.telehealthPreference ?? null;
  summary.startTimeline = lead.startTimeline ?? null;

  const dto = new ClinicLeadDto();
  dto.lead_id = lead.leadId;
  dto.received_at = lead.receivedAt.toISOString();
  dto.lead_source = lead.leadSource;
  dto.patient = patient;
  dto.assessment_summary = summary;
  dto.delivery_status = lead.deliveryStatus;
  dto.clinic_status = lead.clinicStatus;

  return dto;
}

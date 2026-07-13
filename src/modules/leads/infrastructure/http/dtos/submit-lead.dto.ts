import { IsArray, IsEmail, IsOptional, IsString, ArrayMaxSize, MaxLength } from 'class-validator';

/**
 * Matches the .NET `SubmitLeadRequest` field shape, plus an additive optional
 * `claimToken` used to prove ownership of an anonymous assessment.
 */
export class SubmitLeadDto {
  @IsString()
  @MaxLength(200)
  clinicId!: string;

  @IsString()
  @MaxLength(200)
  clinicSlug!: string;

  @IsEmail()
  @MaxLength(320)
  patientEmail!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  patientFirstName?: string;

  @IsString()
  @MaxLength(100)
  treatmentCategory!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  patientZip?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  topGoals?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  topSymptoms?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(50)
  budgetBand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  telehealthPreference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  appointmentPreference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  startTimeline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sessionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  claimToken?: string;
}

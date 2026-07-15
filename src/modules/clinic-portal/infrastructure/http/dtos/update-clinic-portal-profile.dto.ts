import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateClinicPortalProfileRequest {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  about?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  providerName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  websiteUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10)
  stateCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  businessEmail?: string;

  @ApiPropertyOptional({ nullable: true, description: 'Set to null to clear the webhook URL' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  webhookUrl?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  notifyOnLead?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  differentiators?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  offersLabWork?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  insuranceNotes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  credentials?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  npiNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  stateLicenseNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  weeklySummary?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  telehealthAvailable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  newPatientWait?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  consultationFeeBand?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  monthlyProgramBand?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  financingAvailable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  acceptsInsurance?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  treatmentCategories?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Service codes to mark as top/featured' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  topServices?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Complete list of service codes' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allServices?: string[];
}

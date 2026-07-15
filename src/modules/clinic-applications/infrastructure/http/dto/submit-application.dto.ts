import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SubmitApplicationServiceDto } from './submit-application-service.dto';

export class SubmitApplicationDto {
  @ApiProperty({ example: 'Horizon Hormone Health', description: 'Clinic name' })
  @IsString()
  @IsNotEmpty()
  clinicName!: string;

  @ApiProperty({ example: 'apply@example.com', description: 'Primary contact email' })
  @IsEmail()
  contactEmail!: string;

  @ApiPropertyOptional({ example: 'billing@example.com', description: 'Business billing email' })
  @IsEmail()
  @IsOptional()
  businessEmail?: string;

  @ApiPropertyOptional({ example: 'Austin', description: 'City' })
  @IsString()
  @IsOptional()
  city?: string;

  @ApiPropertyOptional({ example: 'TX', description: 'Two-letter state code' })
  @IsString()
  @IsOptional()
  stateCode?: string;

  @ApiPropertyOptional({ example: '78701', description: 'ZIP code' })
  @IsString()
  @IsOptional()
  zipCode?: string;

  @ApiPropertyOptional({ example: 'https://example.com', description: 'Clinic website URL' })
  @IsString()
  @IsOptional()
  websiteUrl?: string;

  @ApiPropertyOptional({ example: true, description: 'Whether telehealth is available' })
  @IsBoolean()
  @IsOptional()
  telehealthAvailable?: boolean;

  @ApiPropertyOptional({ example: false, description: 'Whether the clinic offers lab work' })
  @IsBoolean()
  @IsOptional()
  offersLabWork?: boolean;

  @ApiPropertyOptional({ example: '1-2 weeks', description: 'Typical new patient wait time' })
  @IsString()
  @IsOptional()
  newPatientWait?: string;

  @ApiPropertyOptional({ example: '1234567890', description: 'NPI number' })
  @IsString()
  @IsOptional()
  npiNumber?: string;

  @ApiPropertyOptional({ example: 'TX-MED-001', description: 'State medical license number' })
  @IsString()
  @IsOptional()
  stateLicenseNumber?: string;

  @ApiPropertyOptional({ example: '$100-$200', description: 'Consultation fee band' })
  @IsString()
  @IsOptional()
  consultationFeeBand?: string;

  @ApiPropertyOptional({ example: '$200-$400', description: 'Monthly program fee band' })
  @IsString()
  @IsOptional()
  monthlyProgramBand?: string;

  @ApiPropertyOptional({ example: false, description: 'Whether financing is available' })
  @IsBoolean()
  @IsOptional()
  financingAvailable?: boolean;

  @ApiPropertyOptional({ example: false, description: 'Whether insurance is accepted' })
  @IsBoolean()
  @IsOptional()
  insuranceAccepted?: boolean;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Insurance notes',
    example: 'HSA/FSA accepted.',
  })
  @IsString()
  @IsOptional()
  insuranceNotes?: string | null;

  @ApiPropertyOptional({
    example: 'Specializes in bioidentical hormone replacement therapy.',
    description: 'About the clinic',
  })
  @IsString()
  @IsOptional()
  about?: string;

  @ApiPropertyOptional({
    example: 'Board-certified endocrinologist on staff.',
    description: 'Clinic differentiators',
  })
  @IsString()
  @IsOptional()
  differentiators?: string;

  @ApiPropertyOptional({ example: 'Dr. Elena Voss, MD', description: 'Primary provider name' })
  @IsString()
  @IsOptional()
  providerName?: string;

  @ApiPropertyOptional({
    example: 'MD, Board Certified Endocrinology',
    description: 'Provider credentials',
  })
  @IsString()
  @IsOptional()
  credentials?: string;

  @ApiPropertyOptional({
    example: 'https://storage.example.com/applications/abc/logo.png',
    description: 'Public URL of the uploaded clinic logo',
  })
  @IsString()
  @IsOptional()
  logoUrl?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['https://storage.example.com/applications/abc/photo-1.jpg'],
    description: 'Public URLs of uploaded clinic photos',
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  photoUrls?: string[];

  @ApiProperty({
    type: [String],
    example: ['hormone', 'peptide'],
    description: 'Assessment category codes the clinic serves',
  })
  @IsArray()
  @IsString({ each: true })
  categories!: string[];

  @ApiProperty({
    type: [SubmitApplicationServiceDto],
    description: 'Services the clinic offers',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubmitApplicationServiceDto)
  services!: SubmitApplicationServiceDto[];
}

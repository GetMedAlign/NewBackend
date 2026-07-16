import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApplicationServiceItemDto } from './application-service-item.dto';

export class ApplicationDetailDto {
  @ApiProperty({ description: 'Application UUID' })
  id!: string;

  @ApiProperty({ description: 'Clinic name' })
  clinicName!: string;

  @ApiProperty({ description: 'Primary contact email' })
  contactEmail!: string;

  @ApiPropertyOptional({ description: 'Business billing email', nullable: true })
  businessEmail!: string | null;

  @ApiPropertyOptional({ description: 'City', nullable: true })
  city!: string | null;

  @ApiPropertyOptional({ description: 'Two-letter state code', nullable: true })
  stateCode!: string | null;

  @ApiPropertyOptional({ description: 'ZIP code', nullable: true })
  zipCode!: string | null;

  @ApiPropertyOptional({ description: 'Clinic website URL', nullable: true })
  websiteUrl!: string | null;

  @ApiProperty({ description: 'Whether telehealth is available' })
  telehealthAvailable!: boolean;

  @ApiProperty({ description: 'Whether lab work is offered' })
  offersLabWork!: boolean;

  @ApiPropertyOptional({ description: 'New patient wait time', nullable: true })
  newPatientWait!: string | null;

  @ApiPropertyOptional({ description: 'NPI number', nullable: true })
  npiNumber!: string | null;

  @ApiPropertyOptional({ description: 'State license number', nullable: true })
  stateLicenseNumber!: string | null;

  @ApiPropertyOptional({ description: 'Consultation fee band', nullable: true })
  consultationFeeBand!: string | null;

  @ApiPropertyOptional({ description: 'Monthly program fee band', nullable: true })
  monthlyProgramBand!: string | null;

  @ApiProperty({ description: 'Whether financing is available' })
  financingAvailable!: boolean;

  @ApiProperty({ description: 'Whether insurance is accepted' })
  insuranceAccepted!: boolean;

  @ApiPropertyOptional({ description: 'Insurance notes', nullable: true })
  insuranceNotes!: string | null;

  @ApiPropertyOptional({ description: 'About the clinic', nullable: true })
  about!: string | null;

  @ApiPropertyOptional({ description: 'Key differentiators', nullable: true })
  differentiators!: string | null;

  @ApiPropertyOptional({ description: 'Provider name', nullable: true })
  providerName!: string | null;

  @ApiPropertyOptional({ description: 'Provider credentials', nullable: true })
  credentials!: string | null;

  @ApiPropertyOptional({ description: 'Logo URL', nullable: true })
  logoUrl!: string | null;

  @ApiPropertyOptional({ description: 'Photo URLs', nullable: true, type: [String] })
  photoUrls!: string[] | null;

  @ApiProperty({ description: 'Application status', example: 'pending' })
  status!: string;

  @ApiProperty({ description: 'Submission timestamp' })
  createdAt!: Date;

  @ApiPropertyOptional({ description: 'Review timestamp', nullable: true })
  reviewedAt!: Date | null;

  @ApiProperty({ description: 'Treatment categories', type: [String] })
  categories!: string[];

  @ApiProperty({ description: 'Requested services', type: [ApplicationServiceItemDto] })
  services!: ApplicationServiceItemDto[];
}

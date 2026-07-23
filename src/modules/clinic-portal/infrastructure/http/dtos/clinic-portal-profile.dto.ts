import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ServiceDto {
  @ApiProperty()
  serviceCode!: string;

  @ApiProperty()
  isTopService!: boolean;

  @ApiProperty()
  displayOrder!: number;
}

export class ClinicPortalProfileDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  about!: string | null;

  @ApiPropertyOptional({ nullable: true })
  providerName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  websiteUrl!: string | null;

  @ApiPropertyOptional({ nullable: true })
  city!: string | null;

  @ApiPropertyOptional({ nullable: true })
  stateCode!: string | null;

  @ApiPropertyOptional({ nullable: true })
  zipCode!: string | null;

  @ApiPropertyOptional({ nullable: true })
  location!: string | null;

  @ApiPropertyOptional({ nullable: true })
  businessEmail!: string | null;

  @ApiPropertyOptional({ nullable: true })
  webhookUrl!: string | null;

  @ApiProperty({ description: 'True if a webhook secret has been configured' })
  webhookSecretConfigured!: boolean;

  @ApiProperty()
  notifyOnLead!: boolean;

  @ApiPropertyOptional({ nullable: true })
  differentiators!: string | null;

  @ApiProperty()
  offersLabWork!: boolean;

  @ApiPropertyOptional({ nullable: true })
  insuranceNotes!: string | null;

  @ApiPropertyOptional({ nullable: true })
  credentials!: string | null;

  @ApiPropertyOptional({ nullable: true })
  npiNumber!: string | null;

  @ApiPropertyOptional({ nullable: true })
  stateLicenseNumber!: string | null;

  @ApiPropertyOptional({ nullable: true })
  logoUrl!: string | null;

  @ApiProperty()
  photoCount!: number;

  @ApiProperty()
  weeklySummary!: boolean;

  @ApiProperty()
  webhookHealth!: string;

  @ApiProperty()
  billingStatus!: string;

  @ApiPropertyOptional({ nullable: true })
  suspensionReason!: string | null;

  @ApiProperty()
  telehealthAvailable!: boolean;

  @ApiPropertyOptional({ nullable: true })
  newPatientWait!: string | null;

  @ApiPropertyOptional({ nullable: true })
  consultationFeeBand!: string | null;

  @ApiPropertyOptional({ nullable: true })
  monthlyProgramBand!: string | null;

  @ApiProperty()
  financingAvailable!: boolean;

  @ApiProperty()
  acceptsInsurance!: boolean;

  @ApiProperty()
  rating!: number;

  @ApiProperty()
  reviewCount!: number;

  @ApiProperty({ description: 'Primary specialty derived from treatmentCategories' })
  specialty!: string;

  @ApiProperty({ type: [String] })
  treatmentCategories!: string[];

  @ApiProperty({ type: [ServiceDto], description: 'Top/featured services only' })
  services!: ServiceDto[];

  @ApiProperty({ type: [ServiceDto], description: 'All services (top first, then rest)' })
  allServices!: ServiceDto[];

  @ApiProperty()
  leadCount!: number;

  @ApiPropertyOptional({ nullable: true, description: 'Date of most recent lead (yyyy-MM-dd)' })
  lastLeadAt!: string | null;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApplicationSummaryDto {
  @ApiProperty({ description: 'Application UUID' })
  id!: string;

  @ApiProperty({ description: 'Clinic name' })
  clinicName!: string;

  @ApiProperty({ description: 'Contact email address' })
  contactEmail!: string;

  @ApiPropertyOptional({ description: 'City', nullable: true })
  city!: string | null;

  @ApiPropertyOptional({ description: 'Two-letter state code', nullable: true })
  stateCode!: string | null;

  @ApiProperty({ description: 'Application status', example: 'pending' })
  status!: string;

  @ApiProperty({ description: 'Submission timestamp' })
  createdAt!: Date;

  @ApiPropertyOptional({ description: 'Review timestamp', nullable: true })
  reviewedAt!: Date | null;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewApplicationDto {
  @ApiProperty({
    enum: ['approved', 'denied'],
    example: 'approved',
    description: 'Review decision for the application',
  })
  @IsIn(['approved', 'denied'])
  status!: 'approved' | 'denied';

  @ApiPropertyOptional({
    example: 'Incomplete NPI verification',
    description: 'Reason shown to the applicant when denying',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  denyReason?: string;
}

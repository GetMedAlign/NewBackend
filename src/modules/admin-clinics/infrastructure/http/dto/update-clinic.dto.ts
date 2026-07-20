import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString } from 'class-validator';

/**
 * Body of PUT /admin/clinics/:id. Every field optional; a field absent or
 * null leaves the corresponding column unchanged (spec §1.2).
 *
 * `status` deliberately has no `@IsIn` validator: an unrecognized value must
 * be silently ignored by the use case (matching .NET's `Enum.TryParse`
 * guard), not rejected with a 400.
 */
export class UpdateClinicDto {
  @ApiPropertyOptional({ example: 'Horizon Hormone Health', description: 'Clinic name' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    example: 'active',
    description: 'One of active, paused, suspended, inactive. An unrecognized value is ignored.',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'About the clinic' })
  @IsOptional()
  @IsString()
  about?: string;

  @ApiPropertyOptional({ description: 'Clinic differentiators' })
  @IsOptional()
  @IsString()
  differentiators?: string;

  @ApiPropertyOptional({ example: 'Dr. Elena Voss, MD', description: 'Primary provider name' })
  @IsOptional()
  @IsString()
  providerName?: string;

  @ApiPropertyOptional({ description: 'Provider credentials' })
  @IsOptional()
  @IsString()
  credentials?: string;

  @ApiPropertyOptional({ example: 'https://example.com', description: 'Clinic website URL' })
  @IsOptional()
  @IsString()
  websiteUrl?: string;

  @ApiPropertyOptional({ example: 'Austin', description: 'City' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'TX', description: 'Two-letter state code' })
  @IsOptional()
  @IsString()
  stateCode?: string;

  @ApiPropertyOptional({ example: '78701', description: 'ZIP code' })
  @IsOptional()
  @IsString()
  zipCode?: string;

  @ApiPropertyOptional({ description: 'Whether telehealth is available' })
  @IsOptional()
  @IsBoolean()
  telehealth?: boolean;

  @ApiPropertyOptional({ description: 'Whether the clinic offers lab work' })
  @IsOptional()
  @IsBoolean()
  offersLabWork?: boolean;

  @ApiPropertyOptional({ description: 'Whether financing is available' })
  @IsOptional()
  @IsBoolean()
  financing?: boolean;

  @ApiPropertyOptional({ description: 'Whether insurance is accepted' })
  @IsOptional()
  @IsBoolean()
  insurance?: boolean;

  @ApiPropertyOptional({ description: 'Insurance notes' })
  @IsOptional()
  @IsString()
  insuranceNotes?: string;

  @ApiPropertyOptional({ example: '$100-$200', description: 'Consultation fee band' })
  @IsOptional()
  @IsString()
  consultationFee?: string;

  @ApiPropertyOptional({ example: '$200-$400', description: 'Monthly program fee band' })
  @IsOptional()
  @IsString()
  monthlyProgram?: string;

  @ApiPropertyOptional({ example: '1-2 weeks', description: 'Typical new patient wait time' })
  @IsOptional()
  @IsString()
  waitTime?: string;

  @ApiPropertyOptional({ example: 4.5, description: 'Rating out of 5' })
  @IsOptional()
  @IsNumber()
  rating?: number;

  @ApiPropertyOptional({ example: 120, description: 'Review count' })
  @IsOptional()
  @IsInt()
  reviewCount?: number;

  @ApiPropertyOptional({ description: 'Whether the clinic is listed in the public directory' })
  @IsOptional()
  @IsBoolean()
  isListedInDirectory?: boolean;

  @ApiPropertyOptional({
    example: 'https://storage.example.com/clinics/abc/logo.png',
    description: 'Public URL of the clinic logo',
  })
  @IsOptional()
  @IsString()
  logoUrl?: string;
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * Body of PUT /admin/patients/:id. Every field optional; a field absent
 * leaves the corresponding column unchanged (spec §1.8).
 *
 * `name` updates `users.name` for the patient's linked user, not a `patients`
 * column. `dob` deliberately has no `@IsDateString()` validator: an
 * unparseable value must be silently ignored by the use case (matching
 * .NET's `DateOnly.TryParse` guard), not rejected with a 400.
 */
export class UpdatePatientDto {
  @ApiPropertyOptional({
    example: 'Alex Rivera',
    description: "The patient's name (writes users.name, not a patients column)",
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    example: '1985-04-12',
    description: 'Date of birth (yyyy-MM-dd). An unparseable value is silently ignored.',
  })
  @IsOptional()
  @IsString()
  dob?: string;

  @ApiPropertyOptional({ example: '90210', description: 'ZIP code' })
  @IsOptional()
  @IsString()
  zipCode?: string;
}

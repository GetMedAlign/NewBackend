import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

/**
 * Shared body for endpoints that let an admin set a user's password directly
 * (POST /admin/clinics/:id/set-password, POST /admin/patients/:id/set-password).
 * Kept outside any single feature module since Task 11 (admin patients) reuses it.
 */
export class SetPasswordDto {
  @ApiProperty({ example: 'NewPassw0rd!', minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword!: string;
}

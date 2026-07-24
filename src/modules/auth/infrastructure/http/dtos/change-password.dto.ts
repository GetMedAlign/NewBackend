import { IsString, IsNotEmpty, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty({ description: 'The user current password' })
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @ApiProperty({ example: 'MyNewSecurePass1!', description: 'New password (min 8 characters)' })
  @IsString()
  @MinLength(8)
  newPassword!: string;
}

import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({ example: 'user@example.com', description: 'Email address of the account' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'a3f9b2c1...', description: 'Raw reset token from the email link' })
  @IsString()
  token!: string;

  @ApiProperty({ example: 'MyNewSecurePass1!', description: 'New password (min 8 characters)' })
  @IsString()
  @MinLength(8)
  newPassword!: string;
}

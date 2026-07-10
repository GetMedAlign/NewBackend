import { IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class Resend2faDto {
  @ApiProperty({ example: 'user@example.com', description: 'User email address to resend the 2FA code to' })
  @IsEmail()
  email!: string;
}

import { IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResendConfirmationDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'Email address to resend confirmation to',
  })
  @IsEmail()
  email!: string;
}

import { IsEmail, IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ConfirmEmailDto {
  @ApiProperty({ example: 'user@example.com', description: 'Email address to confirm' })
  @IsEmail()
  email!: string;

  @ApiProperty({ description: 'Confirmation token from the email link' })
  @IsString()
  @IsNotEmpty()
  token!: string;
}

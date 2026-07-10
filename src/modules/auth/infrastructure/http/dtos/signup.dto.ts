import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SignupDto {
  @ApiProperty({ example: 'user@example.com', description: 'User email address' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'MySecurePass1!', description: 'Password (min 8 characters)', minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;
}

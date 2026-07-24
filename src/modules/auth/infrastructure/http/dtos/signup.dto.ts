import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SignupDto {
  @ApiProperty({ example: 'user@example.com', description: 'User email address' })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: 'MySecurePass1!',
    description: 'Password (min 8 characters)',
    minLength: 8,
  })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiPropertyOptional({
    example: 'Jane Doe',
    description: 'Full name of the patient signing up',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({
    example: '1990-01-01',
    description:
      'Date of birth as an ISO date string (YYYY-MM-DD). An unparseable value is ignored rather than rejected.',
  })
  @IsOptional()
  @IsString()
  dob?: string;
}

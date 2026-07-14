import { IsEmail, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SigninDto {
  @ApiProperty({
    example: 'clinic-vitality@medalign-seed.example.com',
    description: 'User email address (this example is a seeded clinic user)',
  })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: 'SeedClinic1!',
    description: 'User password (seeded clinic-user password)',
  })
  @IsString()
  password!: string;
}

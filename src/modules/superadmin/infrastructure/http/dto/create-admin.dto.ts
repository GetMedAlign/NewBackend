import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAdminDto {
  @ApiProperty({ example: 'Jane Doe', description: "Admin's full name" })
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: 'jane@medalign.example.com', description: 'Email address' })
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: 'NewPassw0rd!',
    description: 'Password (min 8 characters)',
    minLength: 8,
  })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({ enum: ['admin', 'superadmin'], example: 'admin' })
  @IsIn(['admin', 'superadmin'])
  role!: 'admin' | 'superadmin';
}

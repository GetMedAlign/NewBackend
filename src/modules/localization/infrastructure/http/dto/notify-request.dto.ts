import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class NotifyRequestDto {
  @ApiProperty({ example: 'you@example.com' })
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiPropertyOptional({ example: 'orlando' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  citySlug?: string;
}

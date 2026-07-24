import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class SetAdminPasswordDto {
  @ApiProperty({ example: 'NewPassw0rd!', minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword!: string;
}

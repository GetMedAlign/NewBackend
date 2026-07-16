import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsString, IsNotEmpty } from 'class-validator';

export class SubmitApplicationServiceDto {
  @ApiProperty({ example: 'testosterone-replacement', description: 'Service code identifier' })
  @IsString()
  @IsNotEmpty()
  serviceCode!: string;

  @ApiProperty({ example: true, description: 'Whether this is a top/featured service' })
  @IsBoolean()
  isTopService!: boolean;
}

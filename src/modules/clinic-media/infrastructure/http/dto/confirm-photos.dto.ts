import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';

export class ConfirmPhotosDto {
  @ApiProperty({
    type: [String],
    minItems: 1,
    maxItems: 8,
    description: 'Storage paths returned by the sign endpoint',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @IsString({ each: true })
  paths!: string[];
}

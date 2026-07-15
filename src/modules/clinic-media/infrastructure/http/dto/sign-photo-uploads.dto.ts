import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

export class SignPhotoUploadsDto {
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: 8,
    description: 'Number of photo upload URLs to generate',
  })
  @IsInt()
  @Min(1)
  @Max(8)
  count!: number;
}

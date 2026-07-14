import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';

export class SignLogoUploadDto {
  @ApiProperty({
    enum: ['image/png', 'image/jpeg', 'image/webp'],
    description: 'MIME type of the logo image',
  })
  @IsString()
  @IsIn(['image/png', 'image/jpeg', 'image/webp'])
  contentType!: string;
}

import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';

export class SignVideoUploadDto {
  @ApiProperty({
    enum: ['video/mp4', 'video/webm', 'video/quicktime'],
    description: 'MIME type of the clinic tour video',
  })
  @IsString()
  @IsIn(['video/mp4', 'video/webm', 'video/quicktime'])
  contentType!: string;
}

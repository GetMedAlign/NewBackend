import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ConfirmVideoDto {
  @ApiProperty({
    description: 'Storage path returned by the sign endpoint, e.g. videos/<clinicId>/file.mp4',
  })
  @IsString()
  @IsNotEmpty()
  path!: string;
}

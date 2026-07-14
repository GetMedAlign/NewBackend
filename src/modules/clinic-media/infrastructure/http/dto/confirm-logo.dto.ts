import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ConfirmLogoDto {
  @ApiProperty({
    description: 'Storage path returned by the sign endpoint, e.g. logos/<clinicId>/file.png',
  })
  @IsString()
  @IsNotEmpty()
  path!: string;
}

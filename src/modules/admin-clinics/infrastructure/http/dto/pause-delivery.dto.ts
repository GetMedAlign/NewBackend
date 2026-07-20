import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/** Body of POST /admin/clinics/:id/pause-delivery. */
export class PauseDeliveryDto {
  @ApiProperty({
    example: true,
    description: 'true pauses delivery unconditionally; false un-pauses only if currently paused.',
  })
  @IsBoolean()
  paused!: boolean;
}

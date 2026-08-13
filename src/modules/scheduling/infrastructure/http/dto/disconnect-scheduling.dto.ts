import { ApiProperty } from '@nestjs/swagger';

export class DisconnectSchedulingResponseDto {
  @ApiProperty({ description: 'Always false on success' })
  connected!: boolean;
}

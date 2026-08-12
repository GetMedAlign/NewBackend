import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CalendlyCallbackDto {
  @ApiProperty({ description: 'Authorization code returned by Calendly at the end of OAuth' })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiProperty({ description: 'Opaque state value Calendly echoes back from the authorize request' })
  @IsString()
  @IsNotEmpty()
  state!: string;
}

export class CalendlyCallbackResponseDto {
  @ApiProperty({ description: 'Always true on success' })
  connected!: boolean;

  @ApiProperty({ description: 'Public Calendly booking link for the now-connected clinic' })
  schedulingUrl!: string;
}

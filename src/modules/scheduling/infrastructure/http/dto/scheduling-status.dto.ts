import { ApiProperty } from '@nestjs/swagger';

/** Never includes ciphertext or tokens: safe to return to the client as-is. */
export class SchedulingStatusDto {
  @ApiProperty({ enum: ['none', 'calendly'], description: 'Connected scheduling provider' })
  provider!: 'none' | 'calendly';

  @ApiProperty({ description: 'Whether a scheduling provider is currently connected' })
  connected!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Public Calendly booking link, present once connected',
  })
  schedulingUrl!: string | null;
}

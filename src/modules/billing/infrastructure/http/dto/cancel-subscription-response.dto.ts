import { ApiProperty } from '@nestjs/swagger';

/**
 * Returned by POST /clinic/portal/subscription/cancel (spec §6), matching
 * the .NET `CancelSubscriptionResponse` field names.
 */
export class CancelSubscriptionResponseDto {
  @ApiProperty({ description: 'ISO-8601 timestamp of when the cancellation was recorded' })
  cancelledAt!: string;

  @ApiProperty({
    description: 'ISO-8601 timestamp for the last day of the current month, 23:59:59 UTC',
  })
  activeThrough!: string;
}

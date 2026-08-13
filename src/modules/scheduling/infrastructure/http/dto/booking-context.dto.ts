import { ApiProperty } from '@nestjs/swagger';

/**
 * Patient-facing booking context (Scheduling Slice 4): tells the frontend
 * whether to embed the clinic's Calendly widget or fall back to
 * request-to-book, and (when Calendly) carries the prefill + tracking data
 * for the embed. `trackingToken` is an opaque, authenticated ciphertext
 * blob (`EncryptionPort.encrypt`) that is meant to be handed to the
 * frontend and passed through to Calendly as `utm_content`; it is NOT a
 * Calendly OAuth token or webhook signing key, neither of which this
 * endpoint ever returns.
 */
export class BookingContextDto {
  @ApiProperty({
    enum: ['request', 'calendly'],
    description: 'Which booking flow the frontend should render',
  })
  provider!: 'request' | 'calendly';

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "Clinic's public Calendly scheduling URL; present only when provider is 'calendly'",
  })
  schedulingUrl!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Opaque encrypted tracking token to pass to Calendly as utm_content; the webhook decrypts it server-side to link the booking to a lead. Never a Calendly OAuth token or signing key.',
  })
  trackingToken!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Patient's name, to prefill the Calendly invitee form",
  })
  inviteeName!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Patient's email, to prefill the Calendly invitee form",
  })
  inviteeEmail!: string | null;
}

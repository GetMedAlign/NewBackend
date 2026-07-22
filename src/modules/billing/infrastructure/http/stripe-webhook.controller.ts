import { Controller, HttpCode, Post, Req, type RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../../infrastructure/security/public.decorator';
import { HandleStripeWebhookUseCase } from '../../application/handle-stripe-webhook.use-case';

/**
 * Stripe calls this endpoint directly (no browser, no session cookie) when an
 * invoice is paid or a payment fails (spec §5). It authenticates via the
 * `stripe-signature` header/webhook secret instead of the JWT cookie, so it
 * is `@Public()` and excluded from CSRF (see `app.module.ts`).
 */
@ApiTags('Stripe Webhook')
@Controller('stripe')
export class StripeWebhookController {
  constructor(private readonly handleWebhook: HandleStripeWebhookUseCase) {}

  @Public()
  @Post('webhook')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Stripe invoice webhook (invoice.paid / invoice.payment_failed). ' +
      'Authenticated via the stripe-signature header, not a session cookie.',
  })
  async handle(@Req() req: RawBodyRequest<Request>): Promise<{ received: true }> {
    const sig = req.headers['stripe-signature'];
    const signature = Array.isArray(sig) ? sig[0]! : (sig ?? '');

    // Signature failures are converted to BadRequestException (→ 400) inside
    // the use case; handler/DB errors propagate untouched here and surface
    // as a 500 via the global exception filter, so Stripe retries delivery.
    await this.handleWebhook.handle(req.rawBody as Buffer, signature);

    return { received: true };
  }
}

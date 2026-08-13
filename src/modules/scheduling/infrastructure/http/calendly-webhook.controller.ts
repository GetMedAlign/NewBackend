import { Controller, HttpCode, Param, Post, Req, type RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../../infrastructure/security/public.decorator';
import { HandleCalendlyWebhookUseCase } from '../../application/handle-calendly-webhook.use-case';

/**
 * Calendly calls this endpoint directly (no browser, no session cookie) when
 * an invitee books or cancels (Scheduling Slice 2 §3). It authenticates via
 * the `calendly-webhook-signature` header/per-clinic signing key instead of
 * the JWT cookie, so it is `@Public()` and excluded from CSRF (see
 * `app.module.ts`).
 *
 * The path (`scheduling/calendly/webhook/:clinicId`) matches
 * `CALENDLY_WEBHOOK_URL` + `/${clinicId}`, the exact URL
 * `CalendlyCallbackUseCase` registers with Calendly when a clinic connects.
 */
@ApiTags('Calendly Webhook')
@Controller('scheduling/calendly/webhook')
export class CalendlyWebhookController {
  constructor(private readonly handleWebhook: HandleCalendlyWebhookUseCase) {}

  @Public()
  @Post(':clinicId')
  @HttpCode(200)
  @ApiParam({
    name: 'clinicId',
    description: 'Clinic id the webhook subscription was registered for',
  })
  @ApiOperation({
    summary:
      'Calendly invitee webhook (invitee.created / invitee.canceled). ' +
      'Authenticated via the calendly-webhook-signature header, not a session cookie.',
  })
  async handle(
    @Param('clinicId') clinicId: string,
    @Req() req: RawBodyRequest<Request>,
  ): Promise<{ received: true }> {
    const sig = req.headers['calendly-webhook-signature'];
    const signature = Array.isArray(sig) ? sig[0]! : (sig ?? '');

    // Signature failures are converted to BadRequestException (→ 400) inside
    // the use case; handler/DB errors propagate untouched here and surface
    // as a 500 via the global exception filter, so Calendly retries delivery.
    await this.handleWebhook.handle(clinicId, req.rawBody as Buffer, signature);

    return { received: true };
  }
}

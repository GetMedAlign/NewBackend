import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  APPLICATION_REPOSITORY,
  type ApplicationRepositoryPort,
} from '../domain/ports/application-repository.port';
import {
  PASSWORD_RESET_REPOSITORY,
  type PasswordResetRepositoryPort,
} from '../../auth/domain/ports/password-reset-repository.port';
import {
  EMAIL_SENDER,
  type EmailSenderPort,
} from '../../auth/infrastructure/adapters/email-sender.port';
import { generateResetToken, RESET_TOKEN_TTL_MINUTES } from '../../auth/domain/reset-token';
import { STRIPE_PORT, type StripePort } from '../../billing/domain/ports/stripe.port';
import {
  BILLING_REPOSITORY,
  type BillingRepositoryPort,
} from '../../billing/domain/ports/billing-repository.port';

export interface ReviewApplicationCtx {
  userId: string;
  role: string;
}

export interface ReviewApplicationInput {
  status: 'approved' | 'denied';
  denyReason?: string | null;
}

@Injectable()
export class ReviewApplicationUseCase {
  private readonly logger = new Logger(ReviewApplicationUseCase.name);

  constructor(
    @Inject(APPLICATION_REPOSITORY)
    private readonly repo: ApplicationRepositoryPort,
    @Inject(PASSWORD_RESET_REPOSITORY)
    private readonly resetRepo: PasswordResetRepositoryPort,
    @Inject(EMAIL_SENDER)
    private readonly emailSender: EmailSenderPort,
    @Inject(STRIPE_PORT)
    private readonly stripe: StripePort,
    @Inject(BILLING_REPOSITORY)
    private readonly billingRepo: BillingRepositoryPort,
    private readonly config: ConfigService,
  ) {}

  async execute(
    ctx: ReviewApplicationCtx,
    applicationId: string,
    input: ReviewApplicationInput,
  ): Promise<{ success: true; clinicId?: string }> {
    if (input.status === 'approved') {
      return this.approve(ctx, applicationId);
    }
    if (input.status === 'denied') {
      return this.deny(ctx, applicationId, input.denyReason ?? null);
    }
    throw new BadRequestException('Invalid status');
  }

  private async approve(
    ctx: ReviewApplicationCtx,
    applicationId: string,
  ): Promise<{ success: true; clinicId: string }> {
    const result = await this.repo.approve(ctx, applicationId);
    if (result === 'not_found') throw new NotFoundException('Application not found');
    if (result === 'already_reviewed') throw new ConflictException('Application already reviewed');

    // Provisioning has committed. Token issuance + welcome email must NOT roll
    // back the committed provisioning, so any failure here is logged and swallowed.
    try {
      const { raw, hash } = generateResetToken();
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);
      await this.resetRepo.issue(result.clinicUserId, hash, expiresAt);

      const baseUrl = this.config.get<string>('APP_BASE_URL');
      const link = `${baseUrl}/reset-password?email=${encodeURIComponent(result.loginEmail)}&token=${raw}`;
      await this.emailSender.send(
        result.loginEmail,
        'Welcome to MedAlign — set your password',
        `Your MedAlign clinic account has been approved. Set your password to sign in: ${link}`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to issue welcome/set-password email for clinic user ${result.clinicUserId} (provisioning already committed)`,
        err instanceof Error ? err.stack : String(err),
      );
    }

    // A second, independent best-effort block: Stripe customer creation must
    // NEVER roll back or fail the already-committed provisioning.
    try {
      const customerId = await this.stripe.createCustomer(
        result.clinicName,
        result.loginEmail,
        result.clinicId,
      );
      await this.billingRepo.setClinicStripeCustomerId(
        { userId: ctx.userId, role: ctx.role },
        result.clinicId,
        customerId,
      );
    } catch (err) {
      this.logger.error(
        `Failed to create Stripe customer for clinic ${result.clinicId} (provisioning already committed)`,
        err instanceof Error ? err.stack : String(err),
      );
    }

    return { success: true, clinicId: result.clinicId };
  }

  private async deny(
    ctx: ReviewApplicationCtx,
    applicationId: string,
    denyReason: string | null,
  ): Promise<{ success: true }> {
    const result = await this.repo.deny(ctx, applicationId, denyReason, ctx.userId);
    if (result === 'not_found') throw new NotFoundException('Application not found');
    if (result === 'already_reviewed') throw new ConflictException('Application already reviewed');

    // An email failure does not fail the request.
    try {
      const reasonLine = denyReason ? `\n\nReason: ${denyReason}` : '';
      await this.emailSender.send(
        result.contactEmail,
        'Your MedAlign application',
        `Thank you for applying to MedAlign. After review, we are unable to approve your application for ${result.clinicName} at this time.${reasonLine}`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to send denial email to ${result.contactEmail}`,
        err instanceof Error ? err.stack : String(err),
      );
    }

    return { success: true };
  }
}

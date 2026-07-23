import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { BILLING_REPOSITORY } from './domain/ports/billing-repository.port';
import { STRIPE_PORT } from './domain/ports/stripe.port';
import { STRIPE_WEBHOOK_VERIFIER } from './domain/ports/stripe-webhook-verifier.port';
import { PrismaBillingRepository } from './infrastructure/prisma-billing.repository';
import { StripeAdapter } from './infrastructure/adapters/stripe.adapter';
import { StripeWebhookVerifierAdapter } from './infrastructure/adapters/stripe-webhook-verifier.adapter';
import { GetClinicBillingUseCase } from './application/get-clinic-billing.use-case';
import { UpdateClinicBillingUseCase } from './application/update-clinic-billing.use-case';
import { GetPaymentMethodUseCase } from './application/get-payment-method.use-case';
import { SavePaymentMethodUseCase } from './application/save-payment-method.use-case';
import { RemovePaymentMethodUseCase } from './application/remove-payment-method.use-case';
import { CancelSubscriptionUseCase } from './application/cancel-subscription.use-case';
import { GetAdminClinicBillingUseCase } from './application/get-admin-clinic-billing.use-case';
import { GenerateInvoicesJob } from './application/generate-invoices.job';
import { SuspendOverdueAccountsJob } from './application/suspend-overdue-accounts.job';
import { WeeklySummaryJob } from './application/weekly-summary.job';
import { HandleStripeWebhookUseCase } from './application/handle-stripe-webhook.use-case';
import { ClinicBillingController } from './infrastructure/http/clinic-billing.controller';
import { StripeWebhookController } from './infrastructure/http/stripe-webhook.controller';
import { BillingJobsController } from './infrastructure/http/billing-jobs.controller';
import { JobTriggerGuard } from './infrastructure/http/job-trigger.guard';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ClinicBillingController, StripeWebhookController, BillingJobsController],
  providers: [
    GetClinicBillingUseCase,
    UpdateClinicBillingUseCase,
    GetPaymentMethodUseCase,
    SavePaymentMethodUseCase,
    RemovePaymentMethodUseCase,
    CancelSubscriptionUseCase,
    GetAdminClinicBillingUseCase,
    GenerateInvoicesJob,
    SuspendOverdueAccountsJob,
    WeeklySummaryJob,
    HandleStripeWebhookUseCase,
    JobTriggerGuard,
    {
      provide: BILLING_REPOSITORY,
      useClass: PrismaBillingRepository,
    },
    {
      provide: STRIPE_PORT,
      useClass: StripeAdapter,
    },
    {
      provide: STRIPE_WEBHOOK_VERIFIER,
      useClass: StripeWebhookVerifierAdapter,
    },
  ],
  exports: [
    GetAdminClinicBillingUseCase,
    GenerateInvoicesJob,
    SuspendOverdueAccountsJob,
    WeeklySummaryJob,
    BILLING_REPOSITORY,
    STRIPE_PORT,
  ],
})
export class BillingModule {}

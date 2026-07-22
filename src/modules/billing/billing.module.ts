import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { BILLING_REPOSITORY } from './domain/ports/billing-repository.port';
import { STRIPE_PORT } from './domain/ports/stripe.port';
import { PrismaBillingRepository } from './infrastructure/prisma-billing.repository';
import { StripeAdapter } from './infrastructure/adapters/stripe.adapter';
import { GetClinicBillingUseCase } from './application/get-clinic-billing.use-case';
import { UpdateClinicBillingUseCase } from './application/update-clinic-billing.use-case';
import { GetPaymentMethodUseCase } from './application/get-payment-method.use-case';
import { SavePaymentMethodUseCase } from './application/save-payment-method.use-case';
import { RemovePaymentMethodUseCase } from './application/remove-payment-method.use-case';
import { CancelSubscriptionUseCase } from './application/cancel-subscription.use-case';
import { GetAdminClinicBillingUseCase } from './application/get-admin-clinic-billing.use-case';
import { ClinicBillingController } from './infrastructure/http/clinic-billing.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ClinicBillingController],
  providers: [
    GetClinicBillingUseCase,
    UpdateClinicBillingUseCase,
    GetPaymentMethodUseCase,
    SavePaymentMethodUseCase,
    RemovePaymentMethodUseCase,
    CancelSubscriptionUseCase,
    GetAdminClinicBillingUseCase,
    {
      provide: BILLING_REPOSITORY,
      useClass: PrismaBillingRepository,
    },
    {
      provide: STRIPE_PORT,
      useClass: StripeAdapter,
    },
  ],
  exports: [GetAdminClinicBillingUseCase, BILLING_REPOSITORY, STRIPE_PORT],
})
export class BillingModule {}

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { BILLING_REPOSITORY } from './domain/ports/billing-repository.port';
import { STRIPE_PORT } from './domain/ports/stripe.port';
import { PrismaBillingRepository } from './infrastructure/prisma-billing.repository';
import { StripeAdapter } from './infrastructure/adapters/stripe.adapter';
import { GetClinicBillingUseCase } from './application/get-clinic-billing.use-case';
import { ClinicBillingController } from './infrastructure/http/clinic-billing.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ClinicBillingController],
  providers: [
    GetClinicBillingUseCase,
    {
      provide: BILLING_REPOSITORY,
      useClass: PrismaBillingRepository,
    },
    {
      provide: STRIPE_PORT,
      useClass: StripeAdapter,
    },
  ],
})
export class BillingModule {}

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { CryptoModule } from '../../infrastructure/crypto/crypto.module';
import { CALENDLY_PORT } from './domain/ports/calendly.port';
import { CalendlyHttpAdapter } from './infrastructure/calendly.adapter';
import { CALENDLY_WEBHOOK_VERIFIER } from './domain/ports/calendly-webhook-verifier.port';
import { CalendlyWebhookVerifierAdapter } from './infrastructure/calendly-webhook-verifier.adapter';
import { SCHEDULING_REPOSITORY } from './domain/ports/scheduling-repository.port';
import { PrismaSchedulingRepository } from './infrastructure/prisma-scheduling.repository';
import { GetSchedulingStatusUseCase } from './application/get-scheduling-status.use-case';
import { ConnectAuthorizeUrlUseCase } from './application/connect-authorize-url.use-case';
import { CalendlyCallbackUseCase } from './application/calendly-callback.use-case';
import { DisconnectSchedulingUseCase } from './application/disconnect-scheduling.use-case';
import { SchedulingController } from './infrastructure/http/scheduling.controller';

@Module({
  imports: [ConfigModule, PrismaModule, CryptoModule],
  controllers: [SchedulingController],
  providers: [
    {
      provide: CALENDLY_PORT,
      useClass: CalendlyHttpAdapter,
    },
    {
      provide: CALENDLY_WEBHOOK_VERIFIER,
      useClass: CalendlyWebhookVerifierAdapter,
    },
    {
      provide: SCHEDULING_REPOSITORY,
      useClass: PrismaSchedulingRepository,
    },
    GetSchedulingStatusUseCase,
    ConnectAuthorizeUrlUseCase,
    CalendlyCallbackUseCase,
    DisconnectSchedulingUseCase,
  ],
  exports: [CALENDLY_PORT, CALENDLY_WEBHOOK_VERIFIER],
})
export class SchedulingModule {}

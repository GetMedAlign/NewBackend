import { Module } from '@nestjs/common';

import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { CryptoModule } from '../../infrastructure/crypto/crypto.module';
import { AuthModule } from '../auth/auth.module';
import { ClinicsModule } from '../clinics/clinics.module';
import { AssessmentsModule } from '../assessments/assessments.module';

import { LEAD_REPOSITORY } from './domain/ports/lead-repository.port';
import { WEBHOOK_SENDER } from './domain/ports/webhook-sender.port';
import { PrismaLeadRepository } from './infrastructure/prisma-lead.repository';
import { SsrfWebhookSender } from './infrastructure/ssrf-webhook-sender';
import { SubmitLeadUseCase } from './application/submit-lead.use-case';
import { LeadsController } from './infrastructure/http/leads.controller';

@Module({
  imports: [PrismaModule, CryptoModule, AuthModule, ClinicsModule, AssessmentsModule],
  controllers: [LeadsController],
  providers: [
    SubmitLeadUseCase,
    {
      provide: LEAD_REPOSITORY,
      useClass: PrismaLeadRepository,
    },
    {
      // Constructed via factory (not useClass) so Nest does not try to inject
      // the optional test-seam constructor argument. Production always uses the
      // full SSRF guard with no seam.
      provide: WEBHOOK_SENDER,
      useFactory: (): SsrfWebhookSender => new SsrfWebhookSender(),
    },
  ],
  exports: [LEAD_REPOSITORY],
})
export class LeadsModule {}

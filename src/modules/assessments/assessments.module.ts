import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { CryptoModule } from '../../infrastructure/crypto/crypto.module';
import { AuthModule } from '../auth/auth.module';

import { ClaimTokenService } from './domain/claim-token.service';
import { ASSESSMENT_REPOSITORY } from './domain/ports/assessment-repository.port';
import { PrismaAssessmentRepository } from './infrastructure/prisma-assessment.repository';
import { SubmitAssessmentUseCase } from './application/submit-assessment.use-case';
import { GetLatestAssessmentUseCase } from './application/get-latest-assessment.use-case';
import { AssessmentsController } from './infrastructure/http/assessments.controller';

@Module({
  imports: [ConfigModule, PrismaModule, CryptoModule, AuthModule],
  controllers: [AssessmentsController],
  providers: [
    ClaimTokenService,
    SubmitAssessmentUseCase,
    GetLatestAssessmentUseCase,
    {
      provide: ASSESSMENT_REPOSITORY,
      useClass: PrismaAssessmentRepository,
    },
  ],
  exports: [ClaimTokenService, ASSESSMENT_REPOSITORY],
})
export class AssessmentsModule {}

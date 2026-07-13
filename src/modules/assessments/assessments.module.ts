import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClaimTokenService } from './domain/claim-token.service';

@Module({
  imports: [ConfigModule],
  providers: [ClaimTokenService],
  exports: [ClaimTokenService],
})
export class AssessmentsModule {}

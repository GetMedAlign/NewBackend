import { Module } from '@nestjs/common';
import { AppConfigModule } from './infrastructure/config/config.module';
import { HealthController } from './infrastructure/health/health.controller';

@Module({
  imports: [AppConfigModule],
  controllers: [HealthController],
})
export class AppModule {}

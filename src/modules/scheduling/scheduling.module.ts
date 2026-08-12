import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CALENDLY_PORT } from './domain/ports/calendly.port';
import { CalendlyHttpAdapter } from './infrastructure/calendly.adapter';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: CALENDLY_PORT,
      useClass: CalendlyHttpAdapter,
    },
  ],
  exports: [CALENDLY_PORT],
})
export class SchedulingModule {}

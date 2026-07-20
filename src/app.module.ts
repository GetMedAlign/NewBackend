import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AppConfigModule } from './infrastructure/config/config.module';
import { HealthController } from './infrastructure/health/health.controller';
import { AuthModule } from './modules/auth/auth.module';
import { AssessmentsModule } from './modules/assessments/assessments.module';
import { RecommendationsModule } from './modules/recommendations/recommendations.module';
import { LeadsModule } from './modules/leads/leads.module';
import { PatientsModule } from './modules/patients/patients.module';
import { ClinicPortalModule } from './modules/clinic-portal/clinic-portal.module';
import { ClinicMediaModule } from './modules/clinic-media/clinic-media.module';
import { ClinicApplicationsModule } from './modules/clinic-applications/clinic-applications.module';
import { AdminClinicsModule } from './modules/admin-clinics/admin-clinics.module';
import { AdminPatientsModule } from './modules/admin-patients/admin-patients.module';

import { JwtCookieGuard } from './infrastructure/security/jwt-cookie.guard';
import { RolesGuard } from './infrastructure/security/roles.guard';
import { AllExceptionsFilter } from './infrastructure/security/all-exceptions.filter';
import { CsrfMiddleware } from './infrastructure/security/csrf.middleware';

@Module({
  imports: [
    AppConfigModule,
    AuthModule,
    AssessmentsModule,
    RecommendationsModule,
    LeadsModule,
    PatientsModule,
    ClinicPortalModule,
    ClinicMediaModule,
    ClinicApplicationsModule,
    AdminClinicsModule,
    AdminPatientsModule,
    // Global default rate limit; auth POST routes tighten it via @Throttle.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
  ],
  controllers: [HealthController],
  providers: [
    // Guard order matters: throttle first, then authenticate (fail-closed),
    // then authorize by role.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtCookieGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CsrfMiddleware).forRoutes('*');
  }
}

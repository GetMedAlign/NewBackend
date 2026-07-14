/**
 * Generates openapi.json at the repo root WITHOUT connecting to the database.
 *
 * Strategy: build a minimal NestJS app that registers only the controllers and
 * DTOs needed for metadata extraction, with all infrastructure providers
 * replaced by no-op stubs. This avoids DB connections and eliminates the need
 * for real environment variables.
 *
 * Run with:  pnpm openapi
 */
import 'reflect-metadata';

// Provide minimal env BEFORE any module is loaded so Zod validation passes.
process.env['NODE_ENV'] ??= 'development';
process.env['DATABASE_URL'] ??= 'postgresql://x:x@127.0.0.1:5432/x';
process.env['JWT_SECRET'] ??= 'openapi-gen-placeholder-secret-32chars!!';
process.env['JWT_EXPIRY_MINUTES'] ??= '60';
// ENCRYPTION_KEY must base64-decode to exactly 32 bytes
process.env['ENCRYPTION_KEY'] ??= 'VZbmMdiVnQiIQXt1jRimhBt1UWe5anTdyMtcxJzJ6UM=';
process.env['SENDGRID_API_KEY'] ??= 'SG.placeholder';
process.env['SENDGRID_FROM_EMAIL'] ??= 'noreply@example.com';
process.env['APP_BASE_URL'] ??= 'http://localhost:3000';
process.env['CLAIM_TOKEN_SECRET'] ??= 'openapi-gen-placeholder-claim-secret-32chars!';

import * as path from 'path';
import * as fs from 'fs';
import { Module, type Abstract, type Type } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ThrottlerModule } from '@nestjs/throttler';
import { parseEnv } from '../src/infrastructure/config/env.schema';
import { HealthController } from '../src/infrastructure/health/health.controller';
import { AuthController } from '../src/modules/auth/infrastructure/http/auth.controller';
import { SignUpUseCase } from '../src/modules/auth/application/sign-up.use-case';
import { SignInUseCase } from '../src/modules/auth/application/sign-in.use-case';
import { VerifyTwoFactorUseCase } from '../src/modules/auth/application/verify-two-factor.use-case';
import { ResendTwoFactorUseCase } from '../src/modules/auth/application/resend-two-factor.use-case';
import { GetMeUseCase } from '../src/modules/auth/application/get-me.use-case';
import { SignOutUseCase } from '../src/modules/auth/application/sign-out.use-case';
import { AssessmentsController } from '../src/modules/assessments/infrastructure/http/assessments.controller';
import { SubmitAssessmentUseCase } from '../src/modules/assessments/application/submit-assessment.use-case';
import { GetLatestAssessmentUseCase } from '../src/modules/assessments/application/get-latest-assessment.use-case';
import { RecommendationsController } from '../src/modules/recommendations/infrastructure/http/recommendations.controller';
import { GetRecommendationsUseCase } from '../src/modules/recommendations/application/get-recommendations.use-case';
import { LeadsController } from '../src/modules/leads/infrastructure/http/leads.controller';
import { SubmitLeadUseCase } from '../src/modules/leads/application/submit-lead.use-case';
import { PatientsController } from '../src/modules/patients/infrastructure/http/patients.controller';
import { GetProfileUseCase } from '../src/modules/patients/application/get-profile.use-case';
import { UpdateProfileUseCase } from '../src/modules/patients/application/update-profile.use-case';
import { GetMyLeadsUseCase } from '../src/modules/patients/application/get-my-leads.use-case';
import { ClinicPortalController } from '../src/modules/clinic-portal/infrastructure/http/clinic-portal.controller';
import { GetClinicProfileUseCase } from '../src/modules/clinic-portal/application/get-clinic-profile.use-case';
import { UpdateClinicProfileUseCase } from '../src/modules/clinic-portal/application/update-clinic-profile.use-case';
import { ListClinicLeadsUseCase } from '../src/modules/clinic-portal/application/list-clinic-leads.use-case';
import { GetClinicLeadUseCase } from '../src/modules/clinic-portal/application/get-clinic-lead.use-case';
import { UpdateLeadStatusUseCase } from '../src/modules/clinic-portal/application/update-lead-status.use-case';
import { RequestPatientContactUseCase } from '../src/modules/clinic-portal/application/request-patient-contact.use-case';
import { ListWebhookDeliveriesUseCase } from '../src/modules/clinic-portal/application/list-webhook-deliveries.use-case';
import { RotateWebhookSecretUseCase } from '../src/modules/clinic-portal/application/rotate-webhook-secret.use-case';
import { TestWebhookUseCase } from '../src/modules/clinic-portal/application/test-webhook.use-case';
import { ClinicMediaController } from '../src/modules/clinic-media/infrastructure/http/clinic-media.controller';
import { SignLogoUploadUseCase } from '../src/modules/clinic-media/application/sign-logo-upload.use-case';
import { SignPhotoUploadsUseCase } from '../src/modules/clinic-media/application/sign-photo-uploads.use-case';
import { ConfirmLogoUseCase } from '../src/modules/clinic-media/application/confirm-logo.use-case';
import { ConfirmPhotosUseCase } from '../src/modules/clinic-media/application/confirm-photos.use-case';
import { ListPhotosUseCase } from '../src/modules/clinic-media/application/list-photos.use-case';
import { AUDIT } from '../src/modules/auth/domain/ports/audit.port';

type InjectionToken = string | symbol | Type<unknown> | Abstract<unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const noopStub = { execute: async () => ({}) as any };

function stubProvider(token: InjectionToken): {
  provide: InjectionToken;
  useValue: typeof noopStub;
} {
  return { provide: token, useValue: noopStub };
}

const stubGuard = { canActivate: () => true };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stubFilter = { catch: (_e: unknown, _h: unknown) => undefined as any };

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: parseEnv }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
  ],
  controllers: [
    HealthController,
    AuthController,
    AssessmentsController,
    RecommendationsController,
    LeadsController,
    PatientsController,
    ClinicPortalController,
    ClinicMediaController,
  ],
  providers: [
    // Stub every use-case the controller injects
    stubProvider(SignUpUseCase),
    stubProvider(SignInUseCase),
    stubProvider(VerifyTwoFactorUseCase),
    stubProvider(ResendTwoFactorUseCase),
    stubProvider(GetMeUseCase),
    stubProvider(SignOutUseCase),
    stubProvider(SubmitAssessmentUseCase),
    stubProvider(GetLatestAssessmentUseCase),
    stubProvider(GetRecommendationsUseCase),
    stubProvider(SubmitLeadUseCase),
    stubProvider(GetProfileUseCase),
    stubProvider(UpdateProfileUseCase),
    stubProvider(GetMyLeadsUseCase),
    stubProvider(GetClinicProfileUseCase),
    stubProvider(UpdateClinicProfileUseCase),
    stubProvider(ListClinicLeadsUseCase),
    stubProvider(GetClinicLeadUseCase),
    stubProvider(UpdateLeadStatusUseCase),
    stubProvider(RequestPatientContactUseCase),
    stubProvider(ListWebhookDeliveriesUseCase),
    stubProvider(RotateWebhookSecretUseCase),
    stubProvider(TestWebhookUseCase),
    stubProvider(SignLogoUploadUseCase),
    stubProvider(SignPhotoUploadsUseCase),
    stubProvider(ConfirmLogoUseCase),
    stubProvider(ConfirmPhotosUseCase),
    stubProvider(ListPhotosUseCase),
    stubProvider(AUDIT),
    // Stub global guards/filters so NestJS wires them without crashing
    { provide: APP_GUARD, useValue: stubGuard },
    { provide: APP_GUARD, useValue: stubGuard },
    { provide: APP_GUARD, useValue: stubGuard },
    { provide: APP_FILTER, useValue: stubFilter },
  ],
})
class SwaggerOnlyModule {}

async function generate(): Promise<void> {
  const app = await NestFactory.create(SwaggerOnlyModule, { logger: false });

  const config = new DocumentBuilder()
    .setTitle('MedAlign Backend API')
    .setVersion('0.1.0')
    .setDescription(
      'MedAlign backend API. Authentication uses an HttpOnly `access_token` cookie ' +
        'set on POST /auth/2fa/verify. All non-GET requests require an ' +
        '`x-csrf-token` header matching the value returned by the CSRF middleware.',
    )
    .addCookieAuth('access_token')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  await app.close();

  const outPath = path.join(__dirname, '..', 'openapi.json');
  fs.writeFileSync(outPath, JSON.stringify(document, null, 2), 'utf-8');
  console.log(`openapi.json written to ${outPath}`);
}

generate().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

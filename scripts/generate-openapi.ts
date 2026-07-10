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

type InjectionToken = string | symbol | Type<unknown> | Abstract<unknown>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const noopStub = { execute: async () => ({}) as any };

function stubProvider(token: InjectionToken): { provide: InjectionToken; useValue: typeof noopStub } {
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
  controllers: [HealthController, AuthController],
  providers: [
    // Stub every use-case the controller injects
    stubProvider(SignUpUseCase),
    stubProvider(SignInUseCase),
    stubProvider(VerifyTwoFactorUseCase),
    stubProvider(ResendTwoFactorUseCase),
    stubProvider(GetMeUseCase),
    stubProvider(SignOutUseCase),
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

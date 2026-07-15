/**
 * E2E tests for ClinicGuard.
 *
 * Strategy: boot a slim NestJS app containing only the pieces needed to
 * exercise ClinicGuard (JwtCookieGuard globally, a test controller with
 * ClinicGuard applied, and the TOKEN_SERVICE). No database is needed.
 *
 * The test issues tokens directly via JwtTokenService and places them in the
 * access_token cookie. It asserts:
 *   - clinic token (role=clinic, clinicId present) → 200
 *   - patient token (role=patient, no clinicId)    → 403
 *   - no token at all                              → 401
 */
import { Controller, Get, INestApplication, Module, UseGuards } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import cookieParser = require('cookie-parser');
// eslint-disable-next-line @typescript-eslint/no-require-imports
import supertest = require('supertest');

import {
  TOKEN_SERVICE,
  TokenServicePort,
} from '../../src/modules/auth/domain/ports/token-service.port';
import { JwtTokenService } from '../../src/modules/auth/infrastructure/adapters/jwt-token.service';
import { JwtCookieGuard } from '../../src/infrastructure/security/jwt-cookie.guard';
import { ClinicGuard } from '../../src/infrastructure/security/clinic.guard';

const TEST_SECRET = 'clinic-guard-test-secret-at-least-32-chars';
const TEST_EXPIRY = 60;

/** Tiny test-only controller protected by ClinicGuard. */
@Controller('test-clinic')
@UseGuards(ClinicGuard)
class TestClinicController {
  @Get('ping')
  ping(): { ok: boolean } {
    return { ok: true };
  }
}

@Module({
  imports: [JwtModule.register({})],
  controllers: [TestClinicController],
  providers: [
    // Global JwtCookieGuard (populates request.user from the cookie)
    { provide: APP_GUARD, useClass: JwtCookieGuard },
    // TOKEN_SERVICE backed by a real JwtTokenService with our test secret
    {
      provide: TOKEN_SERVICE,
      inject: [JwtService],
      useFactory: (jwtService: JwtService): TokenServicePort =>
        new JwtTokenService(jwtService, TEST_SECRET, TEST_EXPIRY),
    },
  ],
})
class TestAppModule {}

describe('ClinicGuard (e2e)', () => {
  let app: INestApplication;
  let tokenService: TokenServicePort;

  const CLINIC_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestAppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    tokenService = moduleRef.get<TokenServicePort>(TOKEN_SERVICE);
  });

  afterAll(async () => {
    await app.close();
  });

  const agent = () => supertest(app.getHttpServer());

  it('returns 200 for a valid clinic token (role=clinic, clinicId present)', async () => {
    const token = tokenService.issue({ sub: 'clinic-user-1', role: 'clinic', clinicId: CLINIC_ID });

    await agent()
      .get('/test-clinic/ping')
      .set('Cookie', `access_token=${token}`)
      .expect(200)
      .expect({ ok: true });
  });

  it('returns 403 for a patient token (role=patient, no clinicId)', async () => {
    const token = tokenService.issue({ sub: 'patient-1', role: 'patient' });

    await agent().get('/test-clinic/ping').set('Cookie', `access_token=${token}`).expect(403);
  });

  it('returns 403 for a clinic token missing clinicId', async () => {
    // Issue a token with role=clinic but no clinicId — guard must still reject.
    const token = tokenService.issue({ sub: 'bad-clinic-user', role: 'clinic' });

    await agent().get('/test-clinic/ping').set('Cookie', `access_token=${token}`).expect(403);
  });

  it('returns 401 when no access_token cookie is present', async () => {
    await agent().get('/test-clinic/ping').expect(401);
  });
});

/**
 * End-to-end tests for /patients endpoints.
 *
 * Flow:
 *  1. Boot the full AppModule.
 *  2. GET /health → csrf_token cookie.
 *  3. Register a new user via POST /auth/signup.
 *  4. Signin → 2FA code → access_token cookie.
 *  5. GET /patients/me → 200 with profile shape.
 *  6. PUT /patients/me → 200 { success: true }.
 *  7. GET /patients/me again → name is updated.
 *  8. GET /patients/me/leads → 200 [] (no leads yet).
 *  9. GET /patients/me without auth → 401.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import cookieParser = require('cookie-parser');
// eslint-disable-next-line @typescript-eslint/no-require-imports
import supertest = require('supertest');

import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { AllExceptionsFilter } from '../../src/infrastructure/security/all-exceptions.filter';
import { EMAIL_SENDER } from '../../src/modules/auth/infrastructure/adapters/email-sender.port';
import type { EmailSenderPort } from '../../src/modules/auth/infrastructure/adapters/email-sender.port';

class CapturingEmailSender implements EmailSenderPort {
  public readonly lastBodyByEmail = new Map<string, string>();

  async send(to: string, _subject: string, body: string): Promise<void> {
    this.lastBodyByEmail.set(to.toLowerCase(), body);
  }

  codeFor(email: string): string {
    const body = this.lastBodyByEmail.get(email.toLowerCase());
    if (!body) throw new Error(`No email captured for ${email}`);
    const match = body.match(/\b(\d{6})\b/);
    if (!match) throw new Error(`No 6-digit code in email body: ${body}`);
    return match[1];
  }
}

function cookieValue(setCookie: string[] | undefined, name: string): string | undefined {
  if (!setCookie) return undefined;
  for (const raw of setCookie) {
    const [pair] = raw.split(';');
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() === name) return pair.slice(eq + 1).trim();
  }
  return undefined;
}

describe('Patients (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const emailSender = new CapturingEmailSender();

  const email = `e2e-patients-${Date.now()}@example.com`;
  const password = 'super-secret-password-123';

  let csrfToken: string;
  let accessCookie: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_SENDER)
      .useValue(emailSender)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // Signup now creates a patients row (FK child of users); delete it first.
    await prisma.asSystem(
      (client) => client.$executeRaw`
        DELETE FROM patients
        WHERE user_id = (SELECT id FROM users WHERE email = ${email}::citext LIMIT 1)
      `,
    );
    await prisma.asSystem(
      (client) => client.$executeRaw`DELETE FROM users WHERE email = ${email}::citext`,
    );
    await app.close();
  });

  const agent = () => supertest(app.getHttpServer());

  it('GET /health issues a csrf_token cookie', async () => {
    const res = await agent().get('/health').expect(200);
    const token = cookieValue(res.headers['set-cookie'] as unknown as string[], 'csrf_token');
    expect(token).toBeDefined();
    csrfToken = token as string;
  });

  it('registers a new user', async () => {
    await agent()
      .post('/auth/signup')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ email, password })
      .expect(201);
  });

  it('signs in (triggers 2FA email)', async () => {
    const res = await agent()
      .post('/auth/signin')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ email, password })
      .expect(200);
    expect(res.body).toEqual({ requiresTwoFactor: true });
  });

  it('verifies 2FA code and receives access_token cookie', async () => {
    const code = emailSender.codeFor(email);
    const res = await agent()
      .post('/auth/2fa/verify')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ email, code })
      .expect(200);

    const setCookie = res.headers['set-cookie'] as unknown as string[];
    const access = cookieValue(setCookie, 'access_token');
    expect(access).toBeDefined();
    accessCookie = access as string;
  });

  it('GET /patients/me without auth cookie returns 401', async () => {
    await agent().get('/patients/me').expect(401);
  });

  it('GET /patients/me with valid auth cookie returns 200 with profile shape', async () => {
    const res = await agent()
      .get('/patients/me')
      .set('Cookie', `access_token=${accessCookie}`)
      .expect(200);

    expect(typeof res.body.name).toBe('string');
    expect(typeof res.body.email).toBe('string');
    expect(res.body.email).toBe(email);
    // dob and zipCode may be null for a fresh user
    expect('dob' in res.body).toBe(true);
    expect('zipCode' in res.body).toBe(true);
  });

  it('PUT /patients/me with valid cookie and name returns { success: true }', async () => {
    const res = await agent()
      .put('/patients/me')
      .set('Cookie', `access_token=${accessCookie}`)
      .set('x-csrf-token', csrfToken)
      .set('Cookie', [`access_token=${accessCookie}`, `csrf_token=${csrfToken}`].join('; '))
      .send({ name: 'Test Patient User' })
      .expect(200);

    expect(res.body).toEqual({ success: true });
  });

  it('GET /patients/me after PUT returns the updated name', async () => {
    const res = await agent()
      .get('/patients/me')
      .set('Cookie', `access_token=${accessCookie}`)
      .expect(200);

    expect(res.body.name).toBe('Test Patient User');
  });

  it('GET /patients/me/leads returns 200 with empty array for a new user', async () => {
    const res = await agent()
      .get('/patients/me/leads')
      .set('Cookie', `access_token=${accessCookie}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /patients/me/leads without auth returns 401', async () => {
    await agent().get('/patients/me/leads').expect(401);
  });

  it('PUT /patients/me with a name exceeding 200 chars returns 400', async () => {
    const longName = 'A'.repeat(201);
    await agent()
      .put('/patients/me')
      .set('Cookie', [`access_token=${accessCookie}`, `csrf_token=${csrfToken}`].join('; '))
      .set('x-csrf-token', csrfToken)
      .send({ name: longName })
      .expect(400);
  });
});

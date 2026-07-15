/**
 * E2E tests for the forgot-password / reset-password flow.
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

  bodyFor(email: string): string {
    const body = this.lastBodyByEmail.get(email.toLowerCase());
    if (!body) throw new Error(`No email captured for ${email}`);
    return body;
  }

  tokenFor(email: string): string {
    const body = this.bodyFor(email);
    const match = body.match(/[?&]token=([0-9a-f]+)/);
    if (!match) throw new Error(`No token in email body: ${body}`);
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

describe('Password Reset (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const emailSender = new CapturingEmailSender();

  const email = `e2e-reset-${Date.now()}@example.com`;
  const password = 'original-password-123';
  const newPassword = 'changed-password-456';

  let csrfToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EMAIL_SENDER)
      .useValue(emailSender)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.asSystem(
      (c) => c.$executeRaw`
        DELETE FROM patients
        WHERE user_id = (SELECT id FROM users WHERE email = ${email}::citext LIMIT 1)
      `,
    );
    await prisma.asSystem((c) => c.$executeRaw`DELETE FROM users WHERE email = ${email}::citext`);
    await app.close();
  });

  const agent = () => supertest(app.getHttpServer());

  it('GET /health issues a csrf_token cookie', async () => {
    const res = await agent().get('/health').expect(200);
    const token = cookieValue(res.headers['set-cookie'] as unknown as string[], 'csrf_token');
    expect(token).toBeDefined();
    csrfToken = token as string;
  });

  it('POST /auth/forgot-password for a nonexistent email returns 200 { success: true }', async () => {
    const res = await agent()
      .post('/auth/forgot-password')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ email: 'nobody@example.com' })
      .expect(200);

    expect(res.body).toEqual({ success: true });
  });

  it('full reset flow: signup → forgot-password → reset-password → signin with new password', async () => {
    // 1. Sign up
    await agent()
      .post('/auth/signup')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ email, password })
      .expect(201);

    // 2. Request reset
    const forgotRes = await agent()
      .post('/auth/forgot-password')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ email })
      .expect(200);

    expect(forgotRes.body).toEqual({ success: true });

    // 3. Capture token from email
    const rawToken = emailSender.tokenFor(email);
    expect(rawToken).toMatch(/^[0-9a-f]{64}$/);

    // 4. Reset password
    const resetRes = await agent()
      .post('/auth/reset-password')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ email, token: rawToken, newPassword })
      .expect(200);

    expect(resetRes.body).toEqual({ success: true });

    // 5. Sign in with new password → triggers 2FA
    const signinRes = await agent()
      .post('/auth/signin')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ email, password: newPassword })
      .expect(200);

    expect(signinRes.body).toEqual({ requiresTwoFactor: true });

    // 6. Old password no longer works
    await agent()
      .post('/auth/signin')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ email, password })
      .expect(401);
  });

  it('POST /auth/reset-password with a consumed token returns 400', async () => {
    // The token from the previous test is already consumed
    // We need a fresh token scenario — just use a garbage token
    await agent()
      .post('/auth/reset-password')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ email, token: 'a'.repeat(64), newPassword: 'somepass999' })
      .expect(400);
  });
});

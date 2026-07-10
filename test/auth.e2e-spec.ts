import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import cookieParser = require('cookie-parser');
// eslint-disable-next-line @typescript-eslint/no-require-imports
import supertest = require('supertest');

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/infrastructure/security/all-exceptions.filter';
import { EMAIL_SENDER } from '../src/modules/auth/infrastructure/adapters/email-sender.port';
import type { EmailSenderPort } from '../src/modules/auth/infrastructure/adapters/email-sender.port';

/**
 * In-memory email sender that captures the last body emailed to each address,
 * so the test can recover the 6-digit 2FA code that is otherwise only stored
 * hashed in the database.
 */
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

/** Extracts a single cookie value by name from a Set-Cookie header array. */
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

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const emailSender = new CapturingEmailSender();

  const email = `e2e-auth-${Date.now()}@example.com`;
  const password = 'super-secret-password-123';

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
    // Clean up the created user (cascades roles, 2fa codes) via asSystem.
    await prisma.asSystem((client) =>
      client.$executeRaw`DELETE FROM users WHERE email = ${email}::citext`,
    );
    await app.close();
  });

  const agent = () => supertest(app.getHttpServer());

  it('GET /health issues a csrf_token cookie', async () => {
    const res = await agent().get('/health').expect(200);
    const token = cookieValue(res.headers['set-cookie'] as unknown as string[], 'csrf_token');
    expect(token).toBeDefined();
    csrfToken = token as string;
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('POST /auth/signup creates the user and writes a user_created audit row', async () => {
    const res = await agent()
      .post('/auth/signup')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ email, password })
      .expect(201);

    expect(typeof res.body.userId).toBe('string');
    const userId: string = res.body.userId;

    const rows = await prisma.asSystem((client) =>
      client.$queryRaw<{ action_type: string }[]>`
        SELECT action_type
        FROM audit_log
        WHERE action_type = 'user_created'
          AND affected_record = ${`users:${userId}`}
        LIMIT 1
      `,
    );
    expect(rows.length).toBe(1);
  });

  it('POST /auth/signin returns requiresTwoFactor and sets NO access_token cookie', async () => {
    const res = await agent()
      .post('/auth/signin')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ email, password })
      .expect(200);

    expect(res.body).toEqual({ requiresTwoFactor: true });
    const access = cookieValue(res.headers['set-cookie'] as unknown as string[], 'access_token');
    expect(access).toBeUndefined();
  });

  let accessCookie: string;

  it('POST /auth/2fa/verify with the emailed code sets an HttpOnly access_token cookie', async () => {
    const code = emailSender.codeFor(email);

    const res = await agent()
      .post('/auth/2fa/verify')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ email, code })
      .expect(200);

    expect(res.body.role).toBeDefined();
    expect(typeof res.body.userId).toBe('string');
    expect(res.body.token).toBeUndefined();

    const setCookie = res.headers['set-cookie'] as unknown as string[];
    const access = cookieValue(setCookie, 'access_token');
    expect(access).toBeDefined();
    expect(setCookie.some((c) => /access_token=/.test(c) && /HttpOnly/i.test(c))).toBe(true);
    accessCookie = access as string;
  });

  it('GET /auth/me WITH the cookie returns the current user', async () => {
    const res = await agent()
      .get('/auth/me')
      .set('Cookie', `access_token=${accessCookie}`)
      .expect(200);

    expect(res.body.email).toBe(email);
    expect(typeof res.body.userId).toBe('string');
    expect(res.body.role).toBeDefined();
  });

  it('GET /auth/me WITHOUT the cookie returns 401 (fail-closed)', async () => {
    await agent().get('/auth/me').expect(401);
  });

  it('POST /auth/signout with cookie + csrf clears the access_token cookie', async () => {
    const res = await agent()
      .post('/auth/signout')
      .set('Cookie', [`access_token=${accessCookie}`, `csrf_token=${csrfToken}`].join('; '))
      .set('x-csrf-token', csrfToken)
      .expect(200);

    expect(res.body).toEqual({ ok: true });
    const setCookie = res.headers['set-cookie'] as unknown as string[];
    const cleared = setCookie.some(
      (c) => /access_token=/.test(c) && /(Max-Age=0|Expires=Thu, 01 Jan 1970)/i.test(c),
    );
    expect(cleared).toBe(true);
  });

  it('POST /auth/signin WITHOUT the x-csrf-token header returns 403', async () => {
    await agent()
      .post('/auth/signin')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .send({ email, password })
      .expect(403);
  });

  it('six wrong-password signins lock the account (423) or rate-limit (429)', async () => {
    const lockEmail = `e2e-lock-${Date.now()}@example.com`;

    // Fresh csrf token via a GET.
    const health = await agent().get('/health').expect(200);
    const token = cookieValue(health.headers['set-cookie'] as unknown as string[], 'csrf_token') as string;

    await agent()
      .post('/auth/signup')
      .set('Cookie', `csrf_token=${token}`)
      .set('x-csrf-token', token)
      .send({ email: lockEmail, password })
      .expect(201);

    let lastStatus = 0;
    for (let i = 0; i < 6; i++) {
      const res = await agent()
        .post('/auth/signin')
        .set('Cookie', `csrf_token=${token}`)
        .set('x-csrf-token', token)
        .send({ email: lockEmail, password: 'wrong-password-000' });
      lastStatus = res.status;
    }

    expect([423, 429]).toContain(lastStatus);

    await prisma.asSystem((client) =>
      client.$executeRaw`DELETE FROM users WHERE email = ${lockEmail}::citext`,
    );
  });
});

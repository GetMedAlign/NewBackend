/**
 * E2E tests for the superadmin "team management" routes:
 *   GET    /superadmin/admins
 *   POST   /superadmin/admins
 *   DELETE /superadmin/admins/:id
 *   PUT    /superadmin/admins/:id/password
 *
 * Strategy: boot the full AppModule, craft a superadmin token via
 * JwtTokenService against the seeded superadmin (mirrors
 * admin-clinic-password.e2e-spec.ts), and drive the real HTTP routes with
 * supertest. A CapturingEmailSender records the 2FA email so the happy path
 * can prove the new password actually works for sign-in.
 *
 * Every user created by this file is deleted in afterAll so the shared local
 * test DB ends at its seeded state.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import cookieParser = require('cookie-parser');
// eslint-disable-next-line @typescript-eslint/no-require-imports
import supertest = require('supertest');

import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/infrastructure/security/all-exceptions.filter';
import { EMAIL_SENDER } from '../../src/modules/auth/infrastructure/adapters/email-sender.port';
import type { EmailSenderPort } from '../../src/modules/auth/infrastructure/adapters/email-sender.port';
import { TOKEN_SERVICE } from '../../src/modules/auth/domain/ports/token-service.port';
import type { TokenServicePort } from '../../src/modules/auth/domain/ports/token-service.port';

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

  twoFactorCodeFor(email: string): string {
    const body = this.bodyFor(email);
    const match = /verification code is: (\d{6})/.exec(body);
    if (!match) throw new Error(`No 2FA code in email body: ${body}`);
    return match[1]!;
  }
}

function cookieValue(setCookie: string[] | undefined, name: string): string | undefined {
  if (!setCookie) return undefined;
  for (const raw of setCookie) {
    const [pair] = raw.split(';');
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() === name) return pair.slice(eq + 1).trim();
  }
  return undefined;
}

interface AdminUserBody {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
}

describe('Superadmin team management routes (e2e)', () => {
  let app: INestApplication;
  let tokenService: TokenServicePort;
  let superadminToken: string;
  let nonSuperadminToken: string;
  let csrfToken: string;
  const emailSender = new CapturingEmailSender();

  const createdUserIds: string[] = [];

  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const adapter = new PrismaPg(pool);
  const seedPrisma = new PrismaClient({ adapter });

  let superadminUserId: string;
  const unique = Date.now();

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

    tokenService = moduleRef.get<TokenServicePort>(TOKEN_SERVICE);

    const rows = await seedPrisma.$queryRaw<{ id: string }[]>`
      SELECT u.id FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      WHERE u.email = 'superadmin@medalign-seed.example.com'::citext
        AND ur.role = 'superadmin'
      LIMIT 1
    `;
    if (rows.length === 0) {
      throw new Error('Seeded superadmin not found — run pnpm seed:pj against the test DB first.');
    }
    superadminUserId = rows[0]!.id;

    superadminToken = tokenService.issue({ sub: superadminUserId, role: 'superadmin' });
    // RolesGuard checks the JWT role claim alone (no DB lookup), so a fake
    // sub is fine for proving a plain 'admin' is forbidden from every route.
    nonSuperadminToken = tokenService.issue({ sub: randomUUID(), role: 'admin' });

    const csrfRes = await supertest(app.getHttpServer()).get('/health');
    csrfToken = cookieValue(csrfRes.headers['set-cookie'] as unknown as string[], 'csrf_token')!;
    expect(csrfToken).toBeTruthy();
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await seedPrisma.$executeRaw`DELETE FROM patients WHERE user_id = ${id}::uuid`;
      await seedPrisma.$executeRaw`DELETE FROM users WHERE id = ${id}::uuid`;
    }
    await app.close();
    await seedPrisma.$disconnect();
    await pool.end();
  });

  const agent = () => supertest(app.getHttpServer());
  const superadminHeaders = () => ({
    Cookie: `access_token=${superadminToken}; csrf_token=${csrfToken}`,
    'x-csrf-token': csrfToken,
  });
  const nonSuperadminHeaders = () => ({
    Cookie: `access_token=${nonSuperadminToken}; csrf_token=${csrfToken}`,
    'x-csrf-token': csrfToken,
  });

  it('creates, lists, sets the password of, and deletes an admin (superadmin only)', async () => {
    const email = `superadmin-team-e2e-${unique.toString()}@test.example.com`;

    const createRes = await agent()
      .post('/superadmin/admins')
      .set(superadminHeaders())
      .send({ name: 'E2E Admin', email, password: 'OriginalPass1!', role: 'admin' })
      .expect(201);

    const created = createRes.body as AdminUserBody;
    createdUserIds.push(created.id);
    expect(created.name).toBe('E2E Admin');
    expect(created.email.toLowerCase()).toBe(email.toLowerCase());
    expect(created.role).toBe('admin');
    expect(typeof created.createdAt).toBe('string');

    const listRes = await agent().get('/superadmin/admins').set(superadminHeaders()).expect(200);
    const list = listRes.body as AdminUserBody[];
    expect(list.some((a) => a.id === created.id && a.role === 'admin')).toBe(true);

    const newPassword = 'BrandNewPass2!';
    const setPwRes = await agent()
      .put(`/superadmin/admins/${created.id}/password`)
      .set(superadminHeaders())
      .send({ newPassword })
      .expect(200);
    expect(setPwRes.body).toEqual({ success: true });

    // The new password actually works for a real sign-in.
    const signinRes = await agent()
      .post('/auth/signin')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ email, password: newPassword })
      .expect(200);
    expect(signinRes.body).toEqual({ requiresTwoFactor: true });

    const code = emailSender.twoFactorCodeFor(email);
    await agent()
      .post('/auth/2fa/verify')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({ email, code })
      .expect(200);

    const deleteRes = await agent()
      .delete(`/superadmin/admins/${created.id}`)
      .set(superadminHeaders())
      .expect(200);
    expect(deleteRes.body).toEqual({ success: true });

    // Already gone -> 404.
    await agent().delete(`/superadmin/admins/${created.id}`).set(superadminHeaders()).expect(404);

    // Deleted for real; drop it from the cleanup list.
    const idx = createdUserIds.indexOf(created.id);
    if (idx !== -1) createdUserIds.splice(idx, 1);
  });

  it('rejects creating an admin with an email that already exists', async () => {
    const email = `superadmin-team-e2e-dup-${unique.toString()}@test.example.com`;
    const first = await agent()
      .post('/superadmin/admins')
      .set(superadminHeaders())
      .send({ name: 'Dup Admin', email, password: 'OriginalPass1!', role: 'admin' })
      .expect(201);
    createdUserIds.push((first.body as AdminUserBody).id);

    await agent()
      .post('/superadmin/admins')
      .set(superadminHeaders())
      .send({ name: 'Dup Admin 2', email, password: 'OriginalPass1!', role: 'admin' })
      .expect(409);
  });

  it('rejects a superadmin deleting their own account', async () => {
    await agent()
      .delete(`/superadmin/admins/${superadminUserId}`)
      .set(superadminHeaders())
      .expect(400);
  });

  it('returns 400 when newPassword is shorter than 8 characters', async () => {
    const email = `superadmin-team-e2e-shortpw-${unique.toString()}@test.example.com`;
    const created = await agent()
      .post('/superadmin/admins')
      .set(superadminHeaders())
      .send({ name: 'Short Pw', email, password: 'OriginalPass1!', role: 'admin' })
      .expect(201);
    const id = (created.body as AdminUserBody).id;
    createdUserIds.push(id);

    await agent()
      .put(`/superadmin/admins/${id}/password`)
      .set(superadminHeaders())
      .send({ newPassword: 'short1' })
      .expect(400);
  });

  it('returns 403 for a non-superadmin (e.g. plain admin) on every route', async () => {
    await agent().get('/superadmin/admins').set(nonSuperadminHeaders()).expect(403);
    await agent()
      .post('/superadmin/admins')
      .set(nonSuperadminHeaders())
      .send({ name: 'X', email: 'nobody@test.example.com', password: 'Password1!', role: 'admin' })
      .expect(403);
    await agent()
      .delete(`/superadmin/admins/${randomUUID()}`)
      .set(nonSuperadminHeaders())
      .expect(403);
    await agent()
      .put(`/superadmin/admins/${randomUUID()}/password`)
      .set(nonSuperadminHeaders())
      .send({ newPassword: 'Password1!' })
      .expect(403);
  });
});

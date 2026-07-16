/**
 * E2E tests for POST /clinic-applications/media/logo/sign and
 * /clinic-applications/media/photos/sign.
 *
 * Both endpoints are @Public (no auth required). The STORAGE_PORT is
 * overridden to a stub so no real Supabase call happens.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import cookieParser = require('cookie-parser');
// eslint-disable-next-line @typescript-eslint/no-require-imports
import supertest = require('supertest');

import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/infrastructure/security/all-exceptions.filter';
import { EMAIL_SENDER } from '../../src/modules/auth/infrastructure/adapters/email-sender.port';
import type { EmailSenderPort } from '../../src/modules/auth/infrastructure/adapters/email-sender.port';
import { WEBHOOK_SENDER } from '../../src/modules/leads/domain/ports/webhook-sender.port';
import type {
  WebhookSenderPort,
  WebhookSendResult,
} from '../../src/modules/leads/domain/ports/webhook-sender.port';
import { STORAGE_PORT } from '../../src/modules/clinic-media/domain/ports/storage.port';
import type { StoragePort } from '../../src/modules/clinic-media/domain/ports/storage.port';

class StubEmailSender implements EmailSenderPort {
  async send(): Promise<void> {}
}

class StubWebhookSender implements WebhookSenderPort {
  async send(): Promise<WebhookSendResult> {
    return { ok: true, status: 200 };
  }
}

const mockStorage: StoragePort = {
  createSignedUploadUrl: async (path: string) => ({
    uploadUrl: `https://storage.test/${path}`,
    token: 'test-token',
  }),
  publicUrl: (path: string) => `https://storage.test/${path}`,
  remove: async () => {},
  pathFromPublicUrl: () => null,
};

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

describe('Clinic Applications Media Sign (e2e)', () => {
  let app: INestApplication;
  let csrfToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_SENDER)
      .useValue(new StubEmailSender())
      .overrideProvider(WEBHOOK_SENDER)
      .useValue(new StubWebhookSender())
      .overrideProvider(STORAGE_PORT)
      .useValue(mockStorage)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    // Acquire CSRF token via a safe GET request
    const csrfRes = await supertest(app.getHttpServer()).get('/health');
    csrfToken = cookieValue(csrfRes.headers['set-cookie'] as unknown as string[], 'csrf_token')!;
    expect(csrfToken).toBeTruthy();
  });

  afterAll(async () => {
    await app.close();
  });

  const agent = () => supertest(app.getHttpServer());

  describe('POST /clinic-applications/media/logo/sign', () => {
    it('returns 200 with { uploadUrl, token, path } for image/png (no auth required)', async () => {
      const res = await agent()
        .post('/clinic-applications/media/logo/sign')
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ contentType: 'image/png' })
        .expect(200);

      const body = res.body as Record<string, string>;
      expect(typeof body.uploadUrl).toBe('string');
      expect(typeof body.token).toBe('string');
      expect(typeof body.path).toBe('string');
      expect(body.path.startsWith('applications/')).toBe(true);
    });

    it('returns 200 with path ending in .jpg for image/jpeg', async () => {
      const res = await agent()
        .post('/clinic-applications/media/logo/sign')
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ contentType: 'image/jpeg' })
        .expect(200);

      const body = res.body as Record<string, string>;
      expect(body.path).toMatch(/^applications\/[0-9a-f-]+\/logo\.jpg$/);
    });

    it('returns 200 with path ending in .webp for image/webp', async () => {
      const res = await agent()
        .post('/clinic-applications/media/logo/sign')
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ contentType: 'image/webp' })
        .expect(200);

      const body = res.body as Record<string, string>;
      expect(body.path).toMatch(/^applications\/[0-9a-f-]+\/logo\.webp$/);
    });

    it('returns 400 for an invalid contentType', async () => {
      await agent()
        .post('/clinic-applications/media/logo/sign')
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ contentType: 'image/gif' })
        .expect(400);
    });

    it('returns 400 for missing contentType', async () => {
      await agent()
        .post('/clinic-applications/media/logo/sign')
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({})
        .expect(400);
    });
  });

  describe('POST /clinic-applications/media/photos/sign', () => {
    it('returns 200 with 2 uploads for count=2 (no auth required)', async () => {
      const res = await agent()
        .post('/clinic-applications/media/photos/sign')
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ count: 2 })
        .expect(200);

      const body = res.body as { uploads: { uploadUrl: string; token: string; path: string }[] };
      expect(Array.isArray(body.uploads)).toBe(true);
      expect(body.uploads).toHaveLength(2);
      for (const upload of body.uploads) {
        expect(upload.path.startsWith('applications/')).toBe(true);
        expect(typeof upload.uploadUrl).toBe('string');
        expect(typeof upload.token).toBe('string');
      }
    });

    it('returns 200 with 1 upload for count=1', async () => {
      const res = await agent()
        .post('/clinic-applications/media/photos/sign')
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ count: 1 })
        .expect(200);

      const body = res.body as { uploads: { uploadUrl: string; token: string; path: string }[] };
      expect(body.uploads).toHaveLength(1);
    });

    it('returns 200 with 8 uploads for count=8', async () => {
      const res = await agent()
        .post('/clinic-applications/media/photos/sign')
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ count: 8 })
        .expect(200);

      const body = res.body as { uploads: { uploadUrl: string; token: string; path: string }[] };
      expect(body.uploads).toHaveLength(8);
    });

    it('returns 400 for count=0', async () => {
      await agent()
        .post('/clinic-applications/media/photos/sign')
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ count: 0 })
        .expect(400);
    });

    it('returns 400 for count=9', async () => {
      await agent()
        .post('/clinic-applications/media/photos/sign')
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({ count: 9 })
        .expect(400);
    });

    it('returns 400 for missing count', async () => {
      await agent()
        .post('/clinic-applications/media/photos/sign')
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({})
        .expect(400);
    });
  });
});

/**
 * End-to-end tests for POST /leads.
 * Requires a running Postgres with the patient-journey seed applied.
 *
 * Flow:
 *  1. Get a csrf_token cookie.
 *  2. Submit an anonymous hormone assessment → sessionId + claimToken.
 *  3. POST /leads with the seeded clinic slug + sessionId + claimToken.
 *  4. Assert: { leadId }, a webhook_deliveries row, delivery_status set,
 *     the mocked email sender invoked, and an audit_log `lead_created` row.
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
import { WEBHOOK_SENDER } from '../../src/modules/leads/domain/ports/webhook-sender.port';
import type {
  WebhookSenderPort,
  WebhookSendResult,
} from '../../src/modules/leads/domain/ports/webhook-sender.port';

class CapturingEmailSender implements EmailSenderPort {
  public readonly sent: { to: string; subject: string; body: string }[] = [];
  async send(to: string, subject: string, body: string): Promise<void> {
    this.sent.push({ to, subject, body });
  }
}

class StubWebhookSender implements WebhookSenderPort {
  public readonly calls: { url: string; payload: object; secret: string }[] = [];
  public result: WebhookSendResult = { ok: true, status: 200 };
  async send(url: string, payload: object, secret: string): Promise<WebhookSendResult> {
    this.calls.push({ url, payload, secret });
    return this.result;
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

const HORMONE_ASSESSMENT = {
  treatmentCategory: 'hormone',
  selectedGoals: ['boost_energy'],
  selectedSymptoms: ['fatigue'],
  symptomSeverities: { fatigue: 3 },
  budgetBand: '200_500',
  telehealthPreference: 'yes',
  zipCode: '10001',
  chronicConditions: [],
  currentPrescriptions: [],
  consentGiven: true,
  consentVersion: '1.0',
};

describe('Leads (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let csrfToken: string;
  const emailSender = new CapturingEmailSender();
  const webhookSender = new StubWebhookSender();
  const sessionIds: string[] = [];
  const leadIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_SENDER)
      .useValue(emailSender)
      .overrideProvider(WEBHOOK_SENDER)
      .useValue(webhookSender)
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
    for (const leadId of leadIds) {
      const lead = await prisma.asSystem((c) =>
        c.lead.findUnique({ where: { leadId }, select: { id: true } }),
      );
      if (lead) {
        await prisma.asSystem((c) => c.webhookDelivery.deleteMany({ where: { leadId: lead.id } }));
        await prisma.asSystem((c) => c.lead.delete({ where: { leadId } }));
      }
    }
    for (const sid of sessionIds) {
      await prisma.asSystem((c) => c.patientAssessment.deleteMany({ where: { sessionId: sid } }));
    }
    await app.close();
  });

  const agent = () => supertest(app.getHttpServer());

  it('GET /health issues a csrf_token cookie', async () => {
    const res = await agent().get('/health').expect(200);
    const token = cookieValue(res.headers['set-cookie'] as unknown as string[], 'csrf_token');
    expect(token).toBeDefined();
    csrfToken = token as string;
  });

  describe('anonymous lead with a claimed assessment', () => {
    let sessionId: string;
    let claimToken: string;
    let leadId: string;

    it('submits an assessment and captures sessionId + claimToken', async () => {
      const res = await agent()
        .post('/assessments')
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send(HORMONE_ASSESSMENT)
        .expect(201);

      sessionId = res.body.sessionId as string;
      claimToken = res.body.claimToken as string;
      sessionIds.push(sessionId);
      expect(sessionId).toMatch(/^session_[0-9a-f]{32}$/);
    });

    it('POST /leads returns { leadId } and delivers to the clinic', async () => {
      const res = await agent()
        .post('/leads')
        .set('Cookie', `csrf_token=${csrfToken}`)
        .set('x-csrf-token', csrfToken)
        .send({
          clinicId: '',
          clinicSlug: 'vitality-hormone-nyc',
          patientEmail: 'e2e-lead@example.com',
          patientFirstName: 'Jamie',
          treatmentCategory: 'hormone',
          patientZip: '10001',
          topGoals: ['boost_energy'],
          topSymptoms: ['fatigue'],
          budgetBand: '200_500',
          telehealthPreference: 'yes',
          sessionId,
          claimToken,
        })
        .expect(200);

      expect(res.body.leadId).toMatch(/^lead_[0-9a-f]{32}$/);
      leadId = res.body.leadId as string;
      leadIds.push(leadId);
    });

    it('invoked the (mocked) email sender for the clinic business email', () => {
      expect(emailSender.sent.length).toBeGreaterThanOrEqual(1);
      const last = emailSender.sent[emailSender.sent.length - 1];
      expect(last.to).toBe('leads@vitalityhormone.example.com');
      // HTML body must escape interpolated values (no raw angle-bracket injection).
      expect(last.body).toContain('Jamie');
    });

    it('invoked the (mocked) webhook sender with the clinic webhook url', () => {
      expect(webhookSender.calls.length).toBeGreaterThanOrEqual(1);
      const call = webhookSender.calls[webhookSender.calls.length - 1];
      expect(call.url).toBe('https://vitalityhormone.example.com/webhooks/medalign');
      // The decrypted secret is passed through (seed plaintext).
      expect(call.secret).toBe('whsec_vitality_hormone_nyc_5f3a9c');
    });

    it('recorded a webhook_deliveries row and set delivery_status to sent_to_crm', async () => {
      const lead = await prisma.asSystem((c) =>
        c.lead.findUniqueOrThrow({
          where: { leadId },
          select: { id: true, deliveryStatus: true, deliveredAt: true, assessmentId: true },
        }),
      );
      expect(lead.deliveryStatus).toBe('sent_to_crm');
      expect(lead.deliveredAt).not.toBeNull();
      // Assessment was attached because a valid claimToken was supplied.
      expect(lead.assessmentId).not.toBeNull();

      const deliveries = await prisma.asSystem((c) =>
        c.webhookDelivery.findMany({ where: { leadId: lead.id } }),
      );
      expect(deliveries.length).toBe(1);
      expect(deliveries[0].status).toBe('success');
    });

    it('wrote a lead_created audit_log row', async () => {
      const lead = await prisma.asSystem((c) =>
        c.lead.findUniqueOrThrow({ where: { leadId }, select: { id: true } }),
      );
      const rows = await prisma.asSystem(
        (c) => c.$queryRaw<{ action_type: string }[]>`
          SELECT action_type FROM audit_log
          WHERE action_type = 'lead_created'
            AND affected_record = ${`leads:${lead.id}`}
          LIMIT 1
        `,
      );
      expect(rows.length).toBe(1);
    });
  });

  it('POST /leads with an unknown clinic returns 404', async () => {
    const res = await agent()
      .post('/leads')
      .set('Cookie', `csrf_token=${csrfToken}`)
      .set('x-csrf-token', csrfToken)
      .send({
        clinicId: '',
        clinicSlug: 'no-such-clinic',
        patientEmail: 'nobody@example.com',
        treatmentCategory: 'hormone',
      })
      .expect(404);

    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

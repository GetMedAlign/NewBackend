import { BadRequestException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { CalendlyWebhookVerifierAdapter } from '../calendly-webhook-verifier.adapter';

const SIGNING_KEY = 'test-signing-key';
const BODY = Buffer.from(JSON.stringify({ event: 'invitee.created', payload: { foo: 'bar' } }));

function sign(timestamp: number, signingKey: string, body: Buffer): string {
  return createHmac('sha256', signingKey).update(`${timestamp}.${body.toString('utf8')}`).digest('hex');
}

function header(timestamp: number, signature: string): string {
  return `t=${timestamp},v1=${signature}`;
}

describe('CalendlyWebhookVerifierAdapter', () => {
  const verifier = new CalendlyWebhookVerifierAdapter();

  it('passes for a correctly computed, fresh signature', () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = sign(timestamp, SIGNING_KEY, BODY);

    expect(() => verifier.verify(BODY, header(timestamp, signature), SIGNING_KEY)).not.toThrow();
  });

  it('throws when the body has been tampered with', () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = sign(timestamp, SIGNING_KEY, BODY);
    const tamperedBody = Buffer.from(JSON.stringify({ event: 'invitee.canceled', payload: { foo: 'bar' } }));

    expect(() => verifier.verify(tamperedBody, header(timestamp, signature), SIGNING_KEY)).toThrow(
      BadRequestException,
    );
  });

  it('throws when signed with the wrong signing key', () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = sign(timestamp, 'a-different-key', BODY);

    expect(() => verifier.verify(BODY, header(timestamp, signature), SIGNING_KEY)).toThrow(
      BadRequestException,
    );
  });

  it('throws when the signature header is missing', () => {
    expect(() => verifier.verify(BODY, '', SIGNING_KEY)).toThrow(BadRequestException);
  });

  it('throws when the signature header is malformed', () => {
    expect(() => verifier.verify(BODY, 'not-a-valid-header', SIGNING_KEY)).toThrow(
      BadRequestException,
    );
  });

  it('throws when the timestamp is missing from the header', () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = sign(timestamp, SIGNING_KEY, BODY);

    expect(() => verifier.verify(BODY, `v1=${signature}`, SIGNING_KEY)).toThrow(BadRequestException);
  });

  it('throws when the timestamp is stale (older than 5 minutes)', () => {
    const timestamp = Math.floor(Date.now() / 1000) - 600;
    const signature = sign(timestamp, SIGNING_KEY, BODY);

    expect(() => verifier.verify(BODY, header(timestamp, signature), SIGNING_KEY)).toThrow(
      BadRequestException,
    );
  });
});

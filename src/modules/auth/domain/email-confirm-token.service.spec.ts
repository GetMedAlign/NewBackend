import type { ConfigService } from '@nestjs/config';
import { EmailConfirmTokenService } from './email-confirm-token.service';

const makeService = (
  secret = 'test-secret-at-least-32-characters-long!!',
): EmailConfirmTokenService =>
  new EmailConfirmTokenService({
    getOrThrow: () => secret,
  } as unknown as ConfigService);

describe('EmailConfirmTokenService', () => {
  it('issues a deterministic token for an email', () => {
    const svc = makeService();
    expect(svc.issue('user@example.com')).toBe(svc.issue('user@example.com'));
  });

  it('is case-insensitive on the email', () => {
    const svc = makeService();
    expect(svc.issue('User@Example.com')).toBe(svc.issue('user@example.com'));
  });

  it('verifies a token it issued', () => {
    const svc = makeService();
    const token = svc.issue('user@example.com');
    expect(svc.verify('user@example.com', token)).toBe(true);
  });

  it('rejects a wrong token', () => {
    const svc = makeService();
    expect(svc.verify('user@example.com', 'not-the-token')).toBe(false);
  });

  it('rejects a token for a different email', () => {
    const svc = makeService();
    const token = svc.issue('user@example.com');
    expect(svc.verify('other@example.com', token)).toBe(false);
  });
});

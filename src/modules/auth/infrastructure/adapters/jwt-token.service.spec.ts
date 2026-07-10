import { JwtService } from '@nestjs/jwt';
import { JwtTokenService } from './jwt-token.service';

const TEST_SECRET = 'test-secret-that-is-definitely-at-least-32-chars';
const TEST_EXPIRY_MINUTES = 60;

function makeService(secret = TEST_SECRET, expiryMinutes = TEST_EXPIRY_MINUTES): JwtTokenService {
  const jwtService = new JwtService({ secret });
  return new JwtTokenService(jwtService, secret, expiryMinutes);
}

describe('JwtTokenService', () => {
  it('issue then verify round-trips sub and role', () => {
    const svc = makeService();
    const token = svc.issue({ sub: 'user-123', role: 'patient' });
    const claims = svc.verify(token);
    expect(claims.sub).toBe('user-123');
    expect(claims.role).toBe('patient');
  });

  it('issue then verify round-trips different roles', () => {
    const svc = makeService();
    const token = svc.issue({ sub: 'admin-456', role: 'admin' });
    const claims = svc.verify(token);
    expect(claims.sub).toBe('admin-456');
    expect(claims.role).toBe('admin');
  });

  it('verify throws on tampered token', () => {
    const svc = makeService();
    const token = svc.issue({ sub: 'user-123', role: 'patient' });
    const parts = token.split('.');
    // Tamper the payload
    const tampered = `${parts[0]}.TAMPERED.${parts[2]}`;
    expect(() => svc.verify(tampered)).toThrow();
  });

  it('verify throws on token signed with a different secret', () => {
    const svc1 = makeService('secret-number-one-padded-to-32-chars-here');
    const svc2 = makeService('secret-number-two-padded-to-32-chars-here');
    const token = svc1.issue({ sub: 'user-123', role: 'patient' });
    expect(() => svc2.verify(token)).toThrow();
  });

  it('verify throws on expired token', async () => {
    // Issue with -1 minute expiry (already expired)
    const jwtService = new JwtService({ secret: TEST_SECRET });
    const svc = new JwtTokenService(jwtService, TEST_SECRET, -1);
    const token = svc.issue({ sub: 'user-123', role: 'patient' });
    expect(() => svc.verify(token)).toThrow();
  });
});

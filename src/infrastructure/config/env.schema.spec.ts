import { parseEnv } from './env.schema';

const validFixture = {
  NODE_ENV: 'development',
  PORT: '3000',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  JWT_SECRET: 'a-secret-that-is-definitely-at-least-32-chars-long',
  JWT_EXPIRY_MINUTES: '60',
  // openssl rand -base64 32 produces a valid 32-byte key
  ENCRYPTION_KEY: 'VZbmMdiVnQiIQXt1jRimhBt1UWe5anTdyMtcxJzJ6UM=',
  SENDGRID_API_KEY: 'SG.test',
  SENDGRID_FROM_EMAIL: 'noreply@example.com',
  APP_BASE_URL: 'http://localhost:3000',
};

describe('parseEnv', () => {
  it('throws when required fields are missing', () => {
    expect(() => parseEnv({})).toThrow();
  });

  it('parses a valid fixture successfully', () => {
    const env = parseEnv(validFixture);

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.DATABASE_URL).toBe('postgresql://user:pass@localhost:5432/db');
    expect(env.JWT_EXPIRY_MINUTES).toBe(60);
    expect(env.COOKIE_DOMAIN).toBeUndefined();
  });

  it('applies defaults for NODE_ENV, PORT, and JWT_EXPIRY_MINUTES', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { NODE_ENV: _n, PORT: _p, JWT_EXPIRY_MINUTES: _e, ...rest } = validFixture;
    const env = parseEnv(rest);

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.JWT_EXPIRY_MINUTES).toBe(60);
  });

  it('throws for ENCRYPTION_KEY that does not decode to 32 bytes', () => {
    // base64 of "short" (5 bytes) — not 32 bytes
    const shortKey = Buffer.from('short').toString('base64');
    expect(() =>
      parseEnv({ ...validFixture, ENCRYPTION_KEY: shortKey }),
    ).toThrow(/32 bytes/);
  });

  it('throws for an invalid NODE_ENV value', () => {
    expect(() =>
      parseEnv({ ...validFixture, NODE_ENV: 'staging' }),
    ).toThrow();
  });

  it('throws for an invalid email in SENDGRID_FROM_EMAIL', () => {
    expect(() =>
      parseEnv({ ...validFixture, SENDGRID_FROM_EMAIL: 'not-an-email' }),
    ).toThrow();
  });

  it('throws for an invalid URL in DATABASE_URL', () => {
    expect(() =>
      parseEnv({ ...validFixture, DATABASE_URL: 'not-a-url' }),
    ).toThrow();
  });
});

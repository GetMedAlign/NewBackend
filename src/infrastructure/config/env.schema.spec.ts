import * as fs from 'fs';
import * as path from 'path';

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
  CLAIM_TOKEN_SECRET: 'test-claim-token-secret-at-least-32-chars!!',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  STRIPE_SECRET_KEY: 'sk_test_fixture',
  STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
  JOB_TRIGGER_SECRET: 'job_fixture',
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
    expect(() => parseEnv({ ...validFixture, ENCRYPTION_KEY: shortKey })).toThrow(/32 bytes/);
  });

  it('throws for an invalid NODE_ENV value', () => {
    expect(() => parseEnv({ ...validFixture, NODE_ENV: 'staging' })).toThrow();
  });

  it('throws for an invalid email in SENDGRID_FROM_EMAIL', () => {
    expect(() => parseEnv({ ...validFixture, SENDGRID_FROM_EMAIL: 'not-an-email' })).toThrow();
  });

  it('throws for an invalid URL in DATABASE_URL', () => {
    expect(() => parseEnv({ ...validFixture, DATABASE_URL: 'not-a-url' })).toThrow();
  });
});

/**
 * Guards against the CI-only failure where a newly-required env var is added to
 * the schema (and to .env / .env.example) but NOT to the committed test/.env.test
 * that CI relies on. Locally, tests can still pass because Nest's ConfigModule
 * also loads the gitignored .env — masking the gap until CI boots without one.
 * This test parses the REAL test/.env.test through the schema, so a missing
 * required key fails here (in `pnpm test`) rather than only in CI's e2e.
 */
describe('test/.env.test satisfies the env schema', () => {
  it('parses the committed CI test env without error', () => {
    const envPath = path.resolve(__dirname, '../../../test/.env.test');
    const raw = fs.readFileSync(envPath, 'utf-8');

    const parsed: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      parsed[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }

    // Fails with the missing key's name if a required schema field is absent
    // from test/.env.test — the exact class of bug that broke CI.
    expect(() => parseEnv(parsed)).not.toThrow();
  });
});

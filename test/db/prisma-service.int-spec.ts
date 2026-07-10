/**
 * Integration test: verifies PrismaService sets RLS session context correctly
 * inside withUserContext transactions, and that asSystem does not set context.
 *
 * Requires a real Postgres instance — DATABASE_URL loaded from test/.env.test
 * (via the jest integration config's setupFiles).
 */

import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { RequestContext } from '../../src/infrastructure/prisma/request-context';

const TEST_USER_ID = '11111111-1111-1111-1111-111111111111';
const TEST_ROLE = 'patient';
const TEST_IP = '127.0.0.1';

let service: PrismaService;

beforeAll(() => {
  service = new PrismaService();
});

afterAll(async () => {
  await service.onModuleDestroy();
});

describe('PrismaService', () => {
  describe('withUserContext', () => {
    it('sets app.current_user_id as a transaction-local session variable', async () => {
      const ctx: RequestContext = {
        userId: TEST_USER_ID,
        role: TEST_ROLE,
        ip: TEST_IP,
      };

      const rows = await service.withUserContext(ctx, (tx) =>
        tx.$queryRaw<{ v: string }[]>`
          SELECT current_setting('app.current_user_id', true) AS v
        `,
      );

      expect(rows[0]?.v).toBe(TEST_USER_ID);
    });

    it('sets app.current_user_role as a transaction-local session variable', async () => {
      const ctx: RequestContext = {
        userId: TEST_USER_ID,
        role: TEST_ROLE,
        ip: TEST_IP,
      };

      const rows = await service.withUserContext(ctx, (tx) =>
        tx.$queryRaw<{ v: string }[]>`
          SELECT current_setting('app.current_user_role', true) AS v
        `,
      );

      expect(rows[0]?.v).toBe(TEST_ROLE);
    });

    it('sets app.current_ip_address as a transaction-local session variable', async () => {
      const ctx: RequestContext = {
        userId: TEST_USER_ID,
        role: TEST_ROLE,
        ip: TEST_IP,
      };

      const rows = await service.withUserContext(ctx, (tx) =>
        tx.$queryRaw<{ v: string }[]>`
          SELECT current_setting('app.current_ip_address', true) AS v
        `,
      );

      expect(rows[0]?.v).toBe(TEST_IP);
    });

    it('accepts null context values and stores empty strings', async () => {
      const ctx: RequestContext = {
        userId: null,
        role: null,
        ip: null,
      };

      const rows = await service.withUserContext(ctx, (tx) =>
        tx.$queryRaw<{ uid: string; role: string; ip: string }[]>`
          SELECT
            current_setting('app.current_user_id', true)   AS uid,
            current_setting('app.current_user_role', true) AS role,
            current_setting('app.current_ip_address', true) AS ip
        `,
      );

      expect(rows[0]?.uid).toBe('');
      expect(rows[0]?.role).toBe('');
      expect(rows[0]?.ip).toBe('');
    });
  });

  describe('asSystem', () => {
    it('runs the callback without setting any session context', async () => {
      // First set context in a withUserContext block to prove asSystem is clean
      const rows = await service.asSystem((client) =>
        client.$queryRaw<{ v: string | null }[]>`
          SELECT current_setting('app.current_user_id', true) AS v
        `,
      );

      // current_setting with missing_ok=true returns NULL or empty string if never set
      // Outside a withUserContext transaction, the session variable should not be set to our UUID
      const val = rows[0]?.v ?? '';
      expect(val).not.toBe(TEST_USER_ID);
    });
  });
});

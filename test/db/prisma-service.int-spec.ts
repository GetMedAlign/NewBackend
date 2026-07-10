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

beforeAll(async () => {
  service = new PrismaService();
  await service.onModuleInit();
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

      const rows = await service.withUserContext(
        ctx,
        (tx) =>
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

      const rows = await service.withUserContext(
        ctx,
        (tx) =>
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

      const rows = await service.withUserContext(
        ctx,
        (tx) =>
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

      const rows = await service.withUserContext(
        ctx,
        (tx) =>
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
    it('transaction-local var does not leak to subsequent pool connections', async () => {
      // Step (a): set the session variable inside a withUserContext transaction
      const ctx: RequestContext = {
        userId: TEST_USER_ID,
        role: TEST_ROLE,
        ip: TEST_IP,
      };
      await service.withUserContext(
        ctx,
        (tx) =>
          tx.$queryRaw<{ v: string }[]>`
          SELECT current_setting('app.current_user_id', true) AS v
        `,
      );

      // Step (b): read the same session variable via asSystem (different pool connection)
      const rows = await service.asSystem(
        (client) =>
          client.$queryRaw<{ v: string }[]>`
          SELECT current_setting('app.current_user_id', true) AS v
        `,
      );

      // Step (c): assert the UUID from step (a) did NOT leak — the value must be empty
      expect(rows[0]?.v ?? '').toBe('');
    });
  });
});

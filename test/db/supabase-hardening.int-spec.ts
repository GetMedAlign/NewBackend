/**
 * Integration test: verifies the Supabase Data API hardening migration
 * (20260714000000_supabase_data_api_hardening) has locked the anon and
 * authenticated roles out of the public schema.
 *
 * On Supabase Postgres (where these roles exist) every assertion must run and
 * pass. On plain Postgres without those roles the anon/authenticated blocks
 * are skipped gracefully so the suite still runs green in all environments.
 *
 * Requires a real Postgres instance — DATABASE_URL loaded from test/.env.test.
 */

import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

let service: PrismaService;

beforeAll(async () => {
  service = new PrismaService();
  await service.onModuleInit();
});

afterAll(async () => {
  await service.onModuleDestroy();
});

async function supabaseRolesExist(): Promise<boolean> {
  const rows = await service.asSystem(
    (client) =>
      client.$queryRaw<{ rolname: string }[]>`
      SELECT rolname FROM pg_roles
      WHERE rolname IN ('anon', 'authenticated')
    `,
  );
  return rows.length === 2;
}

describe('Supabase Data API hardening', () => {
  describe('anon and authenticated schema access', () => {
    it('anon has no USAGE on schema public', async () => {
      if (!(await supabaseRolesExist())) {
        console.log('Skipping: anon/authenticated roles not present');
        return;
      }
      const rows = await service.asSystem(
        (client) =>
          client.$queryRaw<{ has_usage: boolean }[]>`
          SELECT has_schema_privilege('anon', 'public', 'USAGE') AS has_usage
        `,
      );
      expect(rows[0]?.has_usage).toBe(false);
    });

    it('authenticated has no USAGE on schema public', async () => {
      if (!(await supabaseRolesExist())) {
        console.log('Skipping: anon/authenticated roles not present');
        return;
      }
      const rows = await service.asSystem(
        (client) =>
          client.$queryRaw<{ has_usage: boolean }[]>`
          SELECT has_schema_privilege('authenticated', 'public', 'USAGE') AS has_usage
        `,
      );
      expect(rows[0]?.has_usage).toBe(false);
    });
  });

  describe('anon and authenticated function access', () => {
    it('anon cannot EXECUTE public.create_user', async () => {
      if (!(await supabaseRolesExist())) {
        console.log('Skipping: anon/authenticated roles not present');
        return;
      }
      const rows = await service.asSystem(
        (client) =>
          client.$queryRaw<{ has_exec: boolean }[]>`
          SELECT has_function_privilege('anon', 'public.create_user(citext, text)', 'EXECUTE') AS has_exec
        `,
      );
      expect(rows[0]?.has_exec).toBe(false);
    });

    it('authenticated cannot EXECUTE public.create_user', async () => {
      if (!(await supabaseRolesExist())) {
        console.log('Skipping: anon/authenticated roles not present');
        return;
      }
      const rows = await service.asSystem(
        (client) =>
          client.$queryRaw<{ has_exec: boolean }[]>`
          SELECT has_function_privilege('authenticated', 'public.create_user(citext, text)', 'EXECUTE') AS has_exec
        `,
      );
      expect(rows[0]?.has_exec).toBe(false);
    });

    it('anon cannot EXECUTE public.append_audit_log', async () => {
      if (!(await supabaseRolesExist())) {
        console.log('Skipping: anon/authenticated roles not present');
        return;
      }
      const rows = await service.asSystem(
        (client) =>
          client.$queryRaw<{ has_exec: boolean }[]>`
          SELECT has_function_privilege(
            'anon',
            'public.append_audit_log(uuid, text, text, text, text, jsonb, jsonb, text)',
            'EXECUTE'
          ) AS has_exec
        `,
      );
      expect(rows[0]?.has_exec).toBe(false);
    });

    it('authenticated cannot EXECUTE public.append_audit_log', async () => {
      if (!(await supabaseRolesExist())) {
        console.log('Skipping: anon/authenticated roles not present');
        return;
      }
      const rows = await service.asSystem(
        (client) =>
          client.$queryRaw<{ has_exec: boolean }[]>`
          SELECT has_function_privilege(
            'authenticated',
            'public.append_audit_log(uuid, text, text, text, text, jsonb, jsonb, text)',
            'EXECUTE'
          ) AS has_exec
        `,
      );
      expect(rows[0]?.has_exec).toBe(false);
    });
  });

  describe('_prisma_migrations RLS', () => {
    it('_prisma_migrations has RLS enabled when the table exists', async () => {
      const rows = await service.asSystem(
        (client) =>
          client.$queryRaw<{ oid: string }[]>`
          SELECT to_regclass('public._prisma_migrations')::text AS oid
        `,
      );
      if (rows[0]?.oid === null) {
        console.log('Skipping: _prisma_migrations table not present');
        return;
      }
      const rlsRows = await service.asSystem(
        (client) =>
          client.$queryRaw<{ relrowsecurity: boolean }[]>`
          SELECT relrowsecurity
          FROM pg_class
          WHERE relname = '_prisma_migrations'
            AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
        `,
      );
      expect(rlsRows[0]?.relrowsecurity).toBe(true);
    });
  });
});

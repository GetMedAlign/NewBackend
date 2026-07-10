# MedAlign Backend Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Foundation slice of the MedAlign backend rebuild: a hexagonal NestJS service with app-managed auth, Postgres RLS, DB-side audit, and field encryption, proven end to end by an auth vertical slice.

**Architecture:** Hexagonal (domain / application / infrastructure). RLS context is set per-request inside a Prisma interactive transaction (`withUserContext`), so policies read `current_setting('app.current_user_id')`. Audit is enforced by Postgres triggers calling a `SECURITY DEFINER` function. All decisions are fixed in `docs/superpowers/specs/2026-07-10-backend-foundation-design.md` (the source of truth).

**Tech Stack:** NestJS, TypeScript (strict), pnpm, Prisma, Supabase Postgres (local via `supabase start`), argon2, `@nestjs/jwt`, zod, Jest + supertest, SendGrid.

## Global Constraints

- Node 20; package manager **pnpm**; TypeScript **strict**, no implicit `any`.
- **App-managed auth only** — never Supabase Auth / `auth.uid()`. RLS keys off `current_setting('app.current_user_id')` and `current_setting('app.current_user_role')`.
- RLS context is set **only** via the per-request transaction wrapper `PrismaService.withUserContext()`. Never set session vars in middleware on a pooled connection.
- Roles: `patient | clinic | admin | superadmin`.
- Encryption: AES-256-GCM, output `base64(nonce(12) ‖ ciphertext+tag)`, key `ENCRYPTION_KEY` (base64, 32 bytes).
- Tests run against a real local Postgres (`supabase start`), not mocks, for anything touching RLS/audit/SQL.
- TDD: failing test first. Small commits, conventional-commit messages.

---

### Task 1: Project scaffold + validated config + health

**Files:**

- Create: `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `.eslintrc.cjs`, `nest-cli.json`, `jest.config.ts`, `.env.example`, `.nvmrc`
- Create: `src/main.ts`, `src/app.module.ts`
- Create: `src/infrastructure/config/env.schema.ts`, `src/infrastructure/config/config.module.ts`
- Create: `src/infrastructure/health/health.controller.ts`
- Test: `src/infrastructure/config/env.schema.spec.ts`, `test/health.e2e-spec.ts`

**Interfaces:**

- Produces: `Env` (zod-inferred type) and a global Nest `ConfigService<Env, true>`; `GET /health` → `{ status: 'ok' }`.

- [ ] **Step 1: Write failing test** — `env.schema.spec.ts`: `parseEnv({})` throws; `parseEnv(validFixture)` returns typed object; `ENCRYPTION_KEY` not 32 bytes → throws.

```ts
import { parseEnv } from './env.schema';
it('rejects missing vars', () => expect(() => parseEnv({})).toThrow());
it('rejects non-32-byte ENCRYPTION_KEY', () =>
  expect(() =>
    parseEnv({ ...valid, ENCRYPTION_KEY: Buffer.from('short').toString('base64') }),
  ).toThrow(/32 bytes/));
```

- [ ] **Step 2: Run, verify fail** — `pnpm jest env.schema` → FAIL (module not found).
- [ ] **Step 3: Implement** `env.schema.ts` with zod: `NODE_ENV`, `PORT`(coerce), `DATABASE_URL`(url), `JWT_SECRET`(min 32), `JWT_EXPIRY_MINUTES`(coerce, default 60), `ENCRYPTION_KEY`(refine → base64 decodes to 32 bytes), `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`(email), `APP_BASE_URL`(url), `COOKIE_DOMAIN`(optional). Export `parseEnv(raw): Env`.
- [ ] **Step 4:** `config.module.ts`: `ConfigModule.forRoot({ isGlobal: true, validate: parseEnv })`. `main.ts` bootstraps, reads `PORT`. `health.controller.ts` returns `{ status: 'ok' }`.
- [ ] **Step 5: e2e test** `test/health.e2e-spec.ts` (supertest) → `GET /health` = 200 `{status:'ok'}`. Run → PASS.
- [ ] **Step 6: Commit** — `chore: scaffold NestJS app with validated env config and health check`

---

### Task 2: Database schema + migration

**Files:**

- Create: `prisma/schema.prisma`, `supabase/config.toml` (via `supabase init`)
- Create: `prisma/migrations/<ts>_init/migration.sql`
- Test: `test/db/schema.int-spec.ts`

**Interfaces:**

- Produces: tables `users`, `user_roles`, `two_factor_codes`, `audit_log`; enum `app_role`; Prisma models `User`, `UserRole`, `TwoFactorCode`, `AuditLog`.

- [ ] **Step 1:** `supabase init`; document `supabase start` in README. Confirm `DATABASE_URL` points at local Supabase db.
- [ ] **Step 2: Write failing integration test** — connect with Prisma, assert the four tables and the `app_role` enum exist (query `information_schema`). Run → FAIL.
- [ ] **Step 3:** Author `schema.prisma` per spec §5 (snake_case `@map`, `@db.Uuid`, `citext` email, `recovery_phone_encrypted text?`, timestamps `@db.Timestamptz`). `pnpm prisma migrate dev --name init`.
- [ ] **Step 4:** Run integration test against `supabase start` db → PASS.
- [ ] **Step 5: Commit** — `feat(db): add users, roles, 2fa, audit schema and initial migration`

---

### Task 3: PrismaService + `withUserContext` RLS wrapper

**Files:**

- Create: `src/infrastructure/prisma/prisma.service.ts`, `prisma.module.ts`
- Create: `src/infrastructure/prisma/request-context.ts` (`RequestContext = { userId: string|null, role: string|null, ip: string|null }`)
- Test: `src/infrastructure/prisma/prisma.service.int-spec.ts`

**Interfaces:**

- Produces: `PrismaService extends PrismaClient` with
  `withUserContext<T>(ctx: RequestContext, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>` and
  `asSystem<T>(fn): Promise<T>` (no user context; for signup/system).
- Consumes: nothing beyond Prisma.

- [ ] **Step 1: Write failing test** — insert a row via raw SQL, then inside `withUserContext({userId:'…', role:'patient', ip:null}, tx => tx.$queryRaw\`select current_setting('app.current_user_id', true)\`)` returns that userId. Run → FAIL.
- [ ] **Step 2: Implement** `withUserContext`:

```ts
async withUserContext<T>(ctx: RequestContext, fn: (tx) => Promise<T>) {
  return this.$transaction(async (tx) => {
    await tx.$executeRaw`select set_config('app.current_user_id', ${ctx.userId ?? ''}, true)`;
    await tx.$executeRaw`select set_config('app.current_user_role', ${ctx.role ?? ''}, true)`;
    await tx.$executeRaw`select set_config('app.current_ip_address', ${ctx.ip ?? ''}, true)`;
    return fn(tx);
  });
}
```

`asSystem` runs `fn(this)` with no context set.

- [ ] **Step 3:** Run test → PASS.
- [ ] **Step 4: Commit** — `feat(db): add PrismaService with per-request RLS transaction context`

---

### Task 4: RLS policies, has_role, create_user, audit triggers

**Files:**

- Create: `prisma/migrations/<ts>_rls_audit/migration.sql`
- Test: `test/db/rls.int-spec.ts`, `test/db/audit.int-spec.ts`

**Interfaces:**

- Produces: `has_role(uuid, app_role) bool`; `create_user(email citext, password_hash text) returns uuid` (SECURITY DEFINER); `append_audit_log(...)` (SECURITY DEFINER); triggers on `users`, `user_roles`; RLS policies per spec §6–§7. A dedicated DB role `app_authenticated` (RLS-subject) used by the app connection.

- [ ] **Step 1: Write failing RLS test** — seed user A and user B (via `create_user` + role). Using `withUserContext(A)`, `tx.user.findMany()` returns only A's row; `withUserContext(admin)` returns all. Run → FAIL.
- [ ] **Step 2: Write failing audit test** — under `withUserContext(A)`, update A's row; assert an `audit_log` row exists with `actor_user_id = A`, `action_type='user_updated'`; assert a direct `INSERT into audit_log` as `app_authenticated` is rejected. Run → FAIL.
- [ ] **Step 3: Implement migration SQL** — `enable row level security` on all tables; `has_role` (STABLE, SECURITY DEFINER, `search_path=public`); policies (`users`: self select/update via `current_setting('app.current_user_id')::uuid = id`, admin/superadmin read-all via `has_role`; `user_roles`; `audit_log` admin read, no write grants). `append_audit_log(...)` SECURITY DEFINER, `revoke` from public/`app_authenticated`. `audit_users()` / `audit_user_roles()` triggers reading the three `current_setting(...)` vars and calling `append_audit_log`. `create_user(...)` SECURITY DEFINER inserting into `users`. Grant table DML (subject to RLS) to `app_authenticated`; set `DATABASE_URL` to connect as `app_authenticated`.
- [ ] **Step 4:** Run both tests → PASS.
- [ ] **Step 5: Commit** — `feat(db): add RLS policies, role helper, create_user, and audit triggers`

---

### Task 5: AES-256-GCM encryption service

**Files:**

- Create: `src/modules/auth/domain/ports/encryption.port.ts` (`EncryptionPort { encrypt(s:string):string; decrypt(s:string):string }`)
- Create: `src/infrastructure/crypto/aes-gcm-encryption.service.ts`, `crypto.module.ts`
- Test: `src/infrastructure/crypto/aes-gcm-encryption.service.spec.ts`

**Interfaces:**

- Produces: `AesGcmEncryptionService implements EncryptionPort` bound to `EncryptionPort` DI token.

- [ ] **Step 1: Write failing test** — round-trip `decrypt(encrypt(x)) === x`; two `encrypt(x)` differ (random nonce); output is valid base64; tampering the ciphertext throws. Run → FAIL.
- [ ] **Step 2: Implement** using node `crypto`: `randomBytes(12)` nonce, `createCipheriv('aes-256-gcm', key, iv)`, append `getAuthTag()`, output `base64(iv‖ct‖tag)`. Key from `ConfigService.get('ENCRYPTION_KEY')` (base64→32 bytes). Decrypt reverses; auth-tag failure surfaces as an error (not swallowed).
- [ ] **Step 3:** Run → PASS.
- [ ] **Step 4: Commit** — `feat(crypto): add AES-256-GCM field encryption service`

---

### Task 6: Auth domain + outbound adapters

**Files:**

- Create: `src/modules/auth/domain/` — `entities/user.entity.ts`, `value-objects/email.ts`, `value-objects/hashed-password.ts`, `errors/*.ts`, `ports/{user-repository,password-hasher,token-service,two-factor,audit}.port.ts`
- Create: `src/modules/auth/infrastructure/adapters/` — `argon2-password-hasher.ts`, `jwt-token.service.ts`, `email-two-factor.ts`
- Create: `src/modules/auth/infrastructure/persistence/prisma-user.repository.ts`
- Test: value-object specs + adapter specs (argon2 hash/verify; jwt sign/verify; repository int-spec using `withUserContext`/`asSystem`)

**Interfaces:**

- Produces (exact signatures later tasks rely on):
  - `PasswordHasherPort { hash(pw:string):Promise<string>; verify(pw:string, hash:string):Promise<boolean> }`
  - `TokenServicePort { issue(claims:{sub:string; role:string}):string; verify(token:string):{sub:string; role:string} }`
  - `TwoFactorPort { issueCode(userId:string):Promise<void>; verifyCode(userId:string, code:string):Promise<boolean> }`
  - `UserRepositoryPort { create(email:string, passwordHash:string):Promise<string>; findByEmail(email:string):Promise<User|null>; findById(id:string):Promise<User|null>; recordFailedLogin(id):Promise<void>; resetFailedLogin(id):Promise<void> }`
  - `Email` (validates format, lowercases), `HashedPassword` value objects.

- [ ] **Step 1: Write failing tests** — `Email` rejects bad input/normalizes; `Argon2PasswordHasher` verify true for correct pw, false otherwise; `JwtTokenService` issue→verify round-trips claims and rejects tampered tokens; `PrismaUserRepository.create` uses `asSystem` + `create_user`, `findByEmail` under `asSystem`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** value objects (pure), `argon2` adapter (argon2id), `@nestjs/jwt` adapter (secret + expiry from config), `email-two-factor` (generate 6-digit code, store `code_hash` + `expires_at` in `two_factor_codes`, send via SendGrid; `verifyCode` checks hash, expiry, unconsumed, attempts, marks consumed). Repository maps rows ↔ `User`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `feat(auth): add domain model, ports, and outbound adapters`

---

### Task 7: Auth use cases

**Files:**

- Create: `src/modules/auth/application/` — `sign-up.use-case.ts`, `sign-in.use-case.ts`, `verify-two-factor.use-case.ts`, `resend-two-factor.use-case.ts`, `get-me.use-case.ts`, `sign-out.use-case.ts`
- Test: one `.spec.ts` per use case (ports mocked)

**Interfaces:**

- Consumes: all ports from Task 6.
- Produces: use-case classes with `execute(input): Promise<output>`; `SignInUseCase` returns `{ requiresTwoFactor: true }` and never a token; `VerifyTwoFactorUseCase` returns `{ token, userId, role }`.

- [ ] **Step 1: Write failing tests** (mocked ports): sign-up creates user + assigns default `patient` role; sign-in with wrong pw throws `InvalidCredentials` and calls `recordFailedLogin`; sign-in over lockout threshold throws `AccountLocked`; sign-in success issues 2FA and returns `requiresTwoFactor`, no token; verify-2fa with bad code throws and counts attempt; verify-2fa success issues token + resets failed count; get-me returns the user; **uniform-error**: unknown email in sign-in throws the same `InvalidCredentials` as wrong password.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** the six use cases orchestrating ports; enforce lockout (5 fails / 15 min) and dummy-hash verify for unknown emails (timing).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `feat(auth): add sign-up/sign-in/2fa/me/sign-out use cases`

---

### Task 8: HTTP layer, security hardening, end-to-end auth

**Files:**

- Create: `src/modules/auth/infrastructure/http/` — `auth.controller.ts`, `dtos/*.ts`
- Create: `src/infrastructure/security/` — `jwt-cookie.guard.ts` (global, fail-closed), `public.decorator.ts` (`@Public()`), `roles.guard.ts` + `roles.decorator.ts`, `csrf.middleware.ts`, `rate-limit` config, `cookie.ts`, `all-exceptions.filter.ts`, `current-user.decorator.ts`
- Modify: `src/app.module.ts` (wire global guard, filter, rate limiter, auth module)
- Test: `test/auth.e2e-spec.ts`

**Interfaces:**

- Consumes: Task 7 use cases; `TokenServicePort`; `PrismaService.withUserContext`.
- Produces: endpoints `POST /auth/signup|signin|2fa/verify|2fa/send|signout`, `GET /auth/me`; `@Public()`, `@CurrentUser()`, `@Roles()`.

- [ ] **Step 1: Write failing e2e test** (supertest, real db): full flow signup → signin (`requiresTwoFactor:true`, no cookie) → read OTP from db in test → `2fa/verify` (Set-Cookie present) → `GET /auth/me` with cookie = 200 → without cookie = 401 → `signout` clears cookie. Assert an `audit_log` row for the signup. Assert a non-GET without CSRF token = 403. Assert 6th bad signin within window = 429 or `AccountLocked`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** controller (maps DTO ↔ use case; sets/clears HttpOnly+Secure+SameSite cookie via `cookie.ts`); global `JwtCookieGuard` (reads cookie, verifies token, sets request user; `@Public()` opts out → fail-closed); `RolesGuard`; `csrf.middleware` (double-submit token on non-GET); per-IP rate limiting on auth routes; `AllExceptionsFilter` mapping domain errors → clean envelope (uniform auth errors). Requests that touch the db use `withUserContext` from the authenticated user; signup/signin use `asSystem`.
- [ ] **Step 4: Run → PASS;** run full suite `pnpm jest && pnpm test:e2e`.
- [ ] **Step 5: Commit** — `feat(auth): add HTTP endpoints, fail-closed auth, CSRF, rate limiting, e2e`

---

## Self-Review

- **Spec coverage:** §2 scope → Tasks 1–8; §3 decisions (app-managed auth, withUserContext, Prisma, Supabase) → Tasks 3,4,6,7,8; §4 hexagonal layout → Tasks 5–8; §5 data model → Task 2; §6 RLS → Task 4; §7 audit → Task 4; §8 encryption → Task 5; §9 auth flow/API → Tasks 7,8; §10 security fixes → Tasks 7,8; §12 testing → every task (TDD, real db); §13 DoD → satisfied when Task 8 suite is green. `forgot/reset/confirm-email` (spec §9 fast-follow) are intentionally deferred to an immediate follow-up plan, not this slice.
- **Placeholders:** none — each task has concrete tests, signatures, and commands.
- **Type consistency:** port signatures declared once in Task 6 and consumed unchanged in Tasks 7–8 (`requiresTwoFactor`, `issue/verify`, `withUserContext(ctx, fn)`).

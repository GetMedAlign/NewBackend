# MedAlign Backend Rebuild — Foundation Slice Design Spec

| | |
|---|---|
| **Author** | Brian (with Claude) |
| **Date** | 2026-07-10 |
| **Status** | Approved design, ready for planning |
| **Slice** | Phase 1, sub-project 1 of 6: Foundation |

> This spec is the source of truth for the Foundation slice. It supersedes any documents generated earlier in the session by a runaway agent (which were based on discarded assumptions: Supabase Auth, Reclaim's clients/partners domain, and a connection-unsafe RLS pattern). Do not build from those.

---

## 1. Context

We are rebuilding the MedAlign backend (currently ASP.NET Core / .NET 10, at `../MedAlign-Backend`) as a new TypeScript service, so a single developer can own and extend it in the same language as the frontend. The rebuild preserves the existing HTTP API contract so the React frontend needs no changes.

The full rebuild is decomposed into six sub-projects, each with its own spec → plan → build cycle:

1. **Foundation** (this spec)
2. Patient journey (assessments, matching, leads)
3. Clinics and clinic portal
4. Admin and superadmin
5. Billing, background jobs, email
6. Cutover (data migration from SQL Server, go-live)

This spec covers only the Foundation.

## 2. Goal and scope

The Foundation establishes the base every later slice depends on, and proves the full security stack end to end using **authentication as the first vertical slice** (everything depends on auth).

**In scope:**
- NestJS + TypeScript (strict) project on a hexagonal architecture, with a composition root.
- Config module with zod-validated env at boot.
- Prisma against Supabase Postgres, with migrations tooling.
- **RLS baseline**: Postgres Row-Level Security enforced via session variables set inside a per-request transaction.
- **Audit logging** via Postgres triggers + a `SECURITY DEFINER` `append_audit_log()` function (append-only).
- **AES-256-GCM** field-encryption service (format byte-compatible with the .NET service for later data migration).
- **Auth vertical slice**: signup, signin, email 2FA, JWT in HttpOnly cookie, roles, sign-out; plus fail-closed global authorization, CSRF, per-IP rate limiting, uniform (non-enumerating) auth responses.
- Health check.
- TDD test suite (unit + integration against a real local Postgres).

**Out of scope (later slices):** patients, assessments, matching, clinics, clinic portal, admin dashboards, leads, billing/Stripe, webhooks, background jobs, email templates beyond the 2FA/reset transactional sends, and the production data migration.

## 3. Key decisions

- **App-managed authentication (not Supabase Auth).** We issue and verify our own JWTs. Rationale: preserves the current frontend auth contract exactly (same endpoints, same HttpOnly cookie, same email-2FA behavior) and keeps full control over lockout/reset. Auth sits behind a port, so a future switch to Supabase Auth is a contained adapter change. Because auth is app-managed, RLS policies key off `current_setting('app.current_user_id')`, **not** `auth.uid()`.
- **RLS context via a per-request transaction wrapper.** `PrismaService.withUserContext(ctx, fn)` opens an interactive transaction, sets `app.current_user_id` and `app.current_user_role` with `set_config(..., true)` (transaction-local), then runs the repository work on that transaction client. This is connection-pool-safe (the SET and the queries share one connection). We explicitly reject setting session vars in middleware on a pooled connection.
- **Prisma** as the data-access layer, behind repository ports.
- **Supabase Postgres** (Pro plan) as the database; **Railway** hosts the app. Both MedAlign-owned.
- **Audit and encryption patterns adapted from Reclaim** (proven there): DB-side audit triggers + `append_audit_log()`; AES-256-GCM with a random 12-byte nonce, `nonce || ciphertext+tag`, base64, 32-byte key from env.
- **Local test database:** Supabase CLI local stack (`supabase start`, Docker) by default, so integration tests run against a production-like Postgres with real migrations. Fallback: a plain local Postgres if Docker is unavailable.

## 4. Architecture (hexagonal)

Three layers; dependencies point inward only (infrastructure → application → domain; domain depends on nothing).

- **Domain (core).** Pure TypeScript, zero framework/IO imports. Entities and value objects (`User`, `Email`, `HashedPassword`, `Role`), domain errors, and **ports** (interfaces): `UserRepositoryPort`, `PasswordHasherPort`, `TokenServicePort`, `TwoFactorPort`, `AuditPort`, `EncryptionPort`, `ClockPort`.
- **Application (use cases).** One class per use case (`SignUpUseCase`, `SignInUseCase`, `VerifyTwoFactorUseCase`, `ResendTwoFactorUseCase`, `GetMeUseCase`, `SignOutUseCase`). Orchestrates domain + ports; no Nest or Prisma imports.
- **Infrastructure (adapters).**
  - *Inbound:* NestJS controllers, DTOs, guards, global exception filter. Translate HTTP ↔ use cases.
  - *Outbound:* `PrismaUserRepository`, `Argon2PasswordHasher`, `JwtTokenService`, `EmailTwoFactor` (SendGrid), `PostgresAuditAdapter`, `AesGcmEncryptionService`, `SystemClock`. Each implements a domain port.
- **Composition root:** each Nest module binds ports to adapters via DI tokens.

Directory layout:

```
src/
  modules/auth/
    domain/         entities, value-objects, ports, errors   (pure)
    application/    use-cases                                  (orchestration)
    infrastructure/
      http/         auth.controller.ts, dtos, guards
      persistence/  prisma-user.repository.ts
      adapters/     argon2-password-hasher.ts, jwt-token.service.ts, email-two-factor.ts
    auth.module.ts  (composition root)
  shared/kernel/    Result type, base Entity, domain error base
  infrastructure/
    prisma/         prisma.service.ts (+ withUserContext RLS wrapper)
    config/         env schema (zod), config.service.ts
    crypto/         aes-gcm-encryption.service.ts
    audit/          audit.port + postgres adapter
    security/       cookie, csrf, rate-limit, global auth guard, exception filter
    health/         health.controller.ts
  main.ts  app.module.ts
prisma/
  schema.prisma
  migrations/       (Prisma migrations; RLS/policies/triggers as raw SQL blocks)
test/
  integration/      (RLS, audit, encryption, auth-flow — against real Postgres)
docs/superpowers/specs/  (this spec)
```

## 5. Data model (Foundation)

Minimal tables needed to prove the stack. The broader MedAlign schema (patients, clinics, etc.) arrives in later slices.

- **`users`**: `id uuid pk`, `email citext unique`, `password_hash text`, `email_confirmed bool`, `failed_login_count int`, `locked_until timestamptz null`, `recovery_phone_encrypted text null` (demonstrates the encrypted-column path), `created_at timestamptz`, `updated_at timestamptz`.
- **`user_roles`**: `id uuid pk`, `user_id uuid fk`, `role app_role`, unique `(user_id, role)`. `app_role` enum = `patient | clinic | admin | superadmin`.
- **`two_factor_codes`**: `id uuid pk`, `user_id uuid fk`, `code_hash text`, `expires_at timestamptz`, `consumed_at timestamptz null`, `attempts int` (single-use, attempt-limited email OTP).
- **`audit_log`** (append-only): `id`, `created_at`, `actor_user_id uuid null`, `actor_role text`, `ip_address text null`, `action_type text`, `affected_record text`, `previous_value jsonb null`, `new_value jsonb null`, `notes text null`.

Helper: `has_role(_user_id uuid, _role app_role) returns boolean` (`SECURITY DEFINER`, `STABLE`), reading `user_roles`.

## 6. RLS model

RLS enabled on all tables. Policies read the request context set by `withUserContext`:

- `current_setting('app.current_user_id', true)::uuid` — the authenticated user.
- `current_setting('app.current_user_role', true)` — for admin/superadmin checks (defense in depth alongside `has_role`).

Foundation policies:
- **users:** a user may `SELECT`/`UPDATE` their own row (`id = app.current_user_id`); `admin`/`superadmin` may read all.
- **user_roles:** user may read own; `admin`/`superadmin` may manage.
- **audit_log:** `admin`/`superadmin` may `SELECT`; no `INSERT/UPDATE/DELETE` granted to the app role (writes happen only through `append_audit_log`).

The app connects to Postgres as a **non-superuser role subject to RLS** (never the service role for user-scoped requests). One deliberately un-scoped path exists in this slice and is documented: **signup**, which must insert a new `users` row before any user context exists. It is handled by a single `SECURITY DEFINER` `create_user(email, password_hash)` function (validated inputs, returns the new id), so the app never needs a privileged connection. System/background un-scoped operations appear only in later slices.

## 7. Audit model

- A trigger on each mutable table (`users`, `user_roles`) fires `AFTER INSERT/UPDATE/DELETE`, reads the session context, and calls `append_audit_log()`.
- `append_audit_log()` is `SECURITY DEFINER`, `REVOKE`d from public/app roles and only reachable through the trigger; `audit_log` has no direct write grants. This makes the trail tamper-resistant and DB-enforced, fixing the .NET "audit fails open" finding.
- A `skip_audit` session flag exists for controlled bulk operations (off by default).

## 8. Encryption model

- `AesGcmEncryptionService` implements `EncryptionPort`: AES-256-GCM, fresh random 12-byte nonce per call, output `base64(nonce ‖ ciphertext+tag)`. Key from `ENCRYPTION_KEY` (base64, validated to 32 bytes at boot).
- Format is byte-compatible with the .NET AES-GCM columns so Foundation-era and migrated data interoperate.
- Applied to at least `users.recovery_phone_encrypted` to prove the end-to-end encrypted-column path; broadly applied to PHI in later slices.

## 9. Auth flow and API (contract-compatible)

Endpoints mirror the current .NET contract:
- `POST /auth/signup`
- `POST /auth/signin` → verifies password (argon2id, with dummy-hash timing equalization), issues a single-use email OTP, returns `requiresTwoFactor` (no JWT yet).
- `POST /auth/2fa/verify` → validates OTP (single-use, attempt-limited), issues JWT, sets HttpOnly + Secure + SameSite cookie.
- `POST /auth/2fa/send` → resend OTP (rate-limited).
- `GET /auth/me` → current user + role.
- `POST /auth/signout` → clears cookie.

`forgot-password`, `reset-password`, and `confirm-email` belong to the auth module and are implemented in this slice as fast-follow once the core flow is green.

## 10. Cross-cutting security (fixes from the .NET review)

- **Fail-closed authorization:** a global guard requires an authenticated user by default; genuinely public routes opt out with `@Public()`.
- **CSRF:** double-submit token required on state-changing (non-GET) requests, given cookie auth.
- **Cookie flags:** `HttpOnly`, `Secure` (prod), `SameSite` (prefer `Lax`/`Strict`; confirm SPA/API are same-site).
- **Rate limiting:** per-IP on auth endpoints (signin, 2fa/verify, 2fa/send, forgot/reset).
- **Uniform responses / no enumeration** on signin, forgot-password, confirm-email; dummy-hash verify to equalize timing.
- **HSTS** in production; **JWT signing key** from config/secret store; **argon2id** hashing; **account lockout** (e.g. 5 fails / 15 min).

## 11. Data flow, error handling

- **Request flow:** HTTP → controller (validate DTO) → use case → domain + ports → `withUserContext` transaction (sets session vars) → Prisma repository → Postgres (RLS filters rows, audit triggers write log) → result mapped to response.
- **Error handling:** typed domain errors (`InvalidCredentials`, `TwoFactorRequired`, `AccountLocked`, etc.) mapped by a global exception filter to a consistent envelope; no stack traces or internal detail leak; validation errors → 400 via a zod/DTO pipe.

## 12. Testing (TDD)

Tests are written before implementation. Jest.

- **Unit:** use cases with ports mocked; domain value objects (`Email`, `HashedPassword`) invariants.
- **Integration (real local Postgres via `supabase start`):** migrations applied, then:
  1. **RLS** — user A cannot read user B's row; admin can read all.
  2. **Audit** — a mutation writes an append-only audit row with the correct actor/IP; audit is unwritable directly by the app role.
  3. **Encryption** — round-trips, and the stored column is not plaintext.
  4. **Auth flow** — supertest end-to-end: signup → signin (`requiresTwoFactor`) → 2fa/verify (cookie set) → me → signout; plus lockout and uniform-error checks.

## 13. Definition of done

- Builds, lints, and typechecks clean.
- `supabase start` + migrations produce the schema with RLS policies, `has_role`, audit triggers, and `append_audit_log`.
- Auth endpoints match the .NET contract and pass the end-to-end test.
- Global fail-closed auth, CSRF, and per-IP rate limiting are in place.
- The RLS, audit, encryption, and auth-flow integration tests are green.
- Config fails fast on invalid/missing env.

## 14. Tooling

NestJS, TypeScript (strict, no implicit `any`), pnpm, ESLint + Prettier, Jest, zod (config + DTO validation), Prisma, argon2, `@nestjs/jwt`, Node 20 (matches Railway `node:20`). Conventional-commit messages; small, focused commits.

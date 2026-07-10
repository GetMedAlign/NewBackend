# MedAlign Backend — Architecture

Full design: [`docs/superpowers/specs/2026-07-10-backend-foundation-design.md`](./docs/superpowers/specs/2026-07-10-backend-foundation-design.md).

## Layers (hexagonal / ports & adapters)

Dependencies point inward only. The domain depends on nothing.

- **Domain** — pure TypeScript: entities, value objects, domain errors, and **ports** (interfaces the domain needs, e.g. `UserRepositoryPort`, `PasswordHasherPort`, `TokenServicePort`, `TwoFactorPort`, `AuditPort`, `EncryptionPort`).
- **Application** — one class per use case, orchestrating domain + ports. No framework or DB imports.
- **Infrastructure** — adapters that implement ports: inbound (NestJS controllers, guards, DTOs) and outbound (Prisma repositories, argon2 hasher, JWT service, SendGrid 2FA, Postgres audit, AES-GCM encryption).

```
src/
  modules/<feature>/
    domain/          entities, value-objects, ports, errors   (pure)
    application/     use-cases
    infrastructure/  http/, persistence/, adapters/
  shared/kernel/
  infrastructure/    prisma/, config/, crypto/, audit/, security/, health/
```

## Authentication

**App-managed** (not Supabase Auth). We issue and verify our own JWTs, delivered as an HttpOnly cookie, with email-based 2FA. Auth sits behind a port, so switching to Supabase Auth later is a contained adapter change.

## Row-Level Security

Because auth is app-managed, RLS policies key off `current_setting('app.current_user_id')` and `current_setting('app.current_user_role')` — **not** `auth.uid()`.

The request context is set **inside a per-request transaction** via `PrismaService.withUserContext(ctx, fn)` (`set_config(..., true)` = transaction-local), which is connection-pool-safe. Setting session variables in middleware on a pooled connection is explicitly rejected.

Roles: `patient | clinic | admin | superadmin`.

```sql
-- users: a user reads/updates only their own row
CREATE POLICY users_self_select ON users FOR SELECT
  USING (id = current_setting('app.current_user_id', true)::uuid);
```

## Audit logging

Postgres triggers on mutable tables read the session context and call a `SECURITY DEFINER` `append_audit_log()` function. `audit_log` has no direct write grants, so the trail is DB-enforced and tamper-resistant.

## Encryption

`EncryptionPort` implemented by AES-256-GCM (random 12-byte nonce, `base64(nonce ‖ ciphertext+tag)`, 32-byte key from `ENCRYPTION_KEY`). Byte-compatible with the .NET service for later data migration.

## Testing

- **Unit:** domain and use cases with ports mocked.
- **Integration:** against a real local Postgres (`supabase start`), proving RLS isolation, audit writes, encryption round-trips, and the end-to-end auth flow.

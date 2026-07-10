# MedAlign Backend

The MedAlign backend, rebuilt as a hexagonal NestJS (TypeScript) service on Prisma + Supabase Postgres, with app-managed auth, Postgres Row-Level Security, DB-side audit logging, and field encryption.

- **Architecture:** [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- **Design spec:** [`docs/superpowers/specs/2026-07-10-backend-foundation-design.md`](./docs/superpowers/specs/2026-07-10-backend-foundation-design.md)
- **Implementation plan:** [`docs/superpowers/plans/2026-07-10-backend-foundation.md`](./docs/superpowers/plans/2026-07-10-backend-foundation.md)

## Stack

NestJS · TypeScript (strict) · pnpm · Prisma · Supabase Postgres · argon2 · `@nestjs/jwt` · zod · Jest + supertest · SendGrid. Node 20.

## Quick start

```bash
pnpm install
cp .env.example .env.local        # fill in secrets
supabase start                    # local Postgres (Docker)
pnpm prisma migrate dev           # apply migrations (RLS + audit)
pnpm dev                          # http://localhost:3000
```

## Testing

```bash
pnpm test         # unit
pnpm test:int     # integration against local Supabase Postgres
pnpm test:e2e     # e2e against local Supabase Postgres
```

Integration tests run against a real local Postgres and verify RLS isolation, audit writes, encryption round-trips, and the full auth flow.

## API docs

- **Swagger UI**: `http://localhost:3000/docs` — served automatically when the server is running.
- **`openapi.json`**: committed to the repo root. Import directly into Postman via *File → Import → select `openapi.json`*.
- **Regenerate** (offline, no DB required):
  ```bash
  pnpm openapi
  ```
  This runs `scripts/generate-openapi.ts` with stub providers — no database connection needed.

## Auth API (Foundation slice)

Contract-compatible with the existing .NET service, so the frontend is unchanged:

```
POST /auth/signup
POST /auth/signin        -> { requiresTwoFactor: true }   (no token yet)
POST /auth/2fa/verify    -> sets HttpOnly session cookie
POST /auth/2fa/send      -> resend the email OTP
GET  /auth/me            -> current user + role
POST /auth/signout
GET  /health             -> { status: "ok" }
```

Roles: `patient | clinic | admin | superadmin`.

## Rebuild roadmap (6 slices)

1. **Foundation** (this slice) — scaffold, config, Prisma + RLS, audit, encryption, auth vertical slice.
2. Patient journey — assessments, matching, leads.
3. Clinics & clinic portal.
4. Admin & superadmin.
5. Billing, background jobs, email.
6. Cutover — data migration from SQL Server, go-live.

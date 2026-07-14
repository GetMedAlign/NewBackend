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
- **`openapi.json`**: committed to the repo root. Import directly into Postman via _File → Import → select `openapi.json`_.
- **Regenerate** (offline, no DB required):
  ```bash
  pnpm openapi
  ```
  This runs `scripts/generate-openapi.ts` with stub providers — no database connection needed.

> **CSRF & local testing:** the API uses double-submit CSRF (an `x-csrf-token` header must match the `csrf_token` cookie on non-GET requests). Enforcement is **skipped when `NODE_ENV=development`**, so Postman/curl can hit POST routes directly during local dev. CSRF is fully enforced in `test` and `production`.

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

## Patient Journey API

The anonymous-assessment → recommendations → lead → patient dashboard flow:

```
POST /assessments                 -> { sessionId, claimToken }  (anonymous; consent required)
GET  /assessments/latest          -> claim an assessment via ?sessionId=&claimToken= (authenticated; 204 if not yours)
GET  /recommendations/:sessionId  -> ranked clinic matches for the session (public; no PHI)
POST /leads                        -> { leadId }  (anonymous or authenticated; delivers to the clinic)
GET  /patients/me                  -> current patient profile (authenticated)
PUT  /patients/me                  -> update the patient profile (authenticated)
GET  /patients/me/leads            -> the caller's submitted leads (authenticated)
```

The `claimToken` (returned from `POST /assessments`) is the only proof that binds an
anonymous `sessionId` to the caller. A stolen `sessionId` without a valid `claimToken`
cannot claim the assessment or attribute its lead — the token model is stricter than the
.NET original by design.

## Clinic Portal API

The clinic-facing portal — clinic staff log in with the same `/auth/*` flow and receive a JWT that carries `clinicId` (role `clinic`).

```
GET  /clinic/portal/profile                              -> clinic profile (name, about, services, logoUrl, etc.)
PUT  /clinic/portal/profile                              -> partial update (name, about, webhookUrl, services, …)
GET  /clinic/portal/leads                                -> paginated lead list for the clinic
GET  /clinic/portal/leads/:leadId                        -> lead detail
PATCH /clinic/portal/leads/:leadId/status               -> update clinic_status (new|contacted|booked|converted|not_interested)
POST  /clinic/portal/leads/:leadId/contact-request      -> send an outreach email to the patient

POST /clinic/portal/webhook/rotate                       -> generate & store a new webhook secret → { webhookSecret }
GET  /clinic/portal/webhook-deliveries                  -> delivery history (last 50)
POST /clinic/portal/test-webhook                         -> fire a test payload to the given URL → WebhookDeliveryDto

POST /clinic/portal/media/logo/sign                      -> get a pre-signed upload URL for the clinic logo → { uploadUrl, token, path }
POST /clinic/portal/media/logo                           -> confirm logo upload (write path to DB) → { url }
POST /clinic/portal/media/photos/sign                    -> get pre-signed upload URLs for gallery photos → { uploads: [...] }
POST /clinic/portal/media/photos                         -> confirm photo uploads → { urls: [...] }
GET  /clinic/portal/media/photos                         -> list current gallery photo URLs → string[]
```

All `/clinic/portal/*` routes require role `clinic`. A `patient` JWT returns 403. A path under another clinic's storage prefix returns 403.

### New environment variables (Supabase Storage)

| Variable                    | Description                                                        |
| --------------------------- | ------------------------------------------------------------------ |
| `SUPABASE_URL`              | Supabase project URL (e.g. `https://<project>.supabase.co`)        |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (bypasses RLS for signed URL generation) |
| `SUPABASE_STORAGE_BUCKET`   | Storage bucket name for clinic media (e.g. `clinic-media`)         |

Placeholder values are provided in `.env` and `test/.env.test` for local development.

## Rebuild roadmap (6 slices)

1. **Foundation** (this slice) — scaffold, config, Prisma + RLS, audit, encryption, auth vertical slice.
2. Patient journey — assessments, matching, leads.
3. Clinics & clinic portal.
4. Admin & superadmin.
5. Billing, background jobs, email.
6. Cutover — data migration from SQL Server, go-live.

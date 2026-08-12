# Scheduling Slice 1: Calendly connect (backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let a clinic connect (and disconnect) its Calendly account from the portal: OAuth token exchange, encrypted token storage, a registered Calendly webhook subscription, and a per-clinic `scheduling_provider`. No patient-facing booking or webhook receiver yet (slices 2-4).

**Architecture:** A `CalendlyPort` (domain) with a `fetch`-based adapter (infrastructure) handles all Calendly HTTP. Use-cases orchestrate token exchange + `GET /users/me` + webhook subscription create/delete, persisting encrypted secrets on the clinic via the clinic repository. Endpoints live under the existing `clinic/portal` controller behind `ClinicGuard`.

**Tech Stack:** NestJS 10, Prisma 7 + `@prisma/adapter-pg`, Postgres, Node 24 (global `fetch`). Reuse `EncryptionPort` (`AesGcmEncryptionService`). Verify: `npm run typecheck`, `npm run lint`, `npm run build`, `npm run openapi`, `npx jest <touched>`.

## Global Constraints
- Spec: `docs/superpowers/specs/2026-08-11-scheduling-calendly-design.md` (read before Task 1).
- Calendly OAuth + tokens + webhook signing key **encrypted at rest** via the existing `EncryptionPort` (inject the token, do not re-implement crypto).
- No em dashes in code/comments. Keep committed OpenAPI updated (`npm run openapi`). Tests run in CI (jest also works in subagent shells).
- Do NOT commit real Calendly credentials; env vars only. Endpoints are `clinic/portal/...` under `ClinicGuard` + `@CurrentClinic() clinicId`.
- The Calendly webhook subscription is registered here pointing at the MedAlign webhook URL from config; the receiver endpoint itself is slice 2 (it is fine that the URL 404s until then).

## Task 1: Clinic scheduling schema + provider field

**Files:** `prisma/schema.prisma`, a migration under `prisma/migrations/`, `src/modules/clinics/domain/clinic.entity.ts` (+ any read model), `src/modules/clinics/infrastructure/prisma-clinic.repository.ts`.

- [ ] **Step 1:** Add enum `SchedulingProvider { none calendly @@map("scheduling_provider") }` and to `model Clinic`: `schedulingProvider SchedulingProvider @default(none) @map("scheduling_provider")`, plus nullable columns `calendlyUserUri`, `calendlyOrgUri`, `calendlySchedulingUrl`, `calendlyAccessTokenEncrypted`, `calendlyRefreshTokenEncrypted`, `calendlyTokenExpiresAt DateTime? @db.Timestamptz`, `calendlyWebhookUri`, `calendlyWebhookSigningKeyEncrypted` (all `@map` snake_case, all `String?` except the enum + timestamp).
- [ ] **Step 2:** Create the migration by hand (`CREATE TYPE scheduling_provider AS ENUM ('none','calendly');` + `ALTER TABLE clinics ADD COLUMN scheduling_provider scheduling_provider NOT NULL DEFAULT 'none', ADD COLUMN calendly_user_uri text, ...` all nullable). Timestamp after the latest existing migration. `npx prisma generate`. Do NOT run migrate against a DB.
- [ ] **Step 3:** Expose a minimal scheduling status on the clinic read model (`schedulingProvider` and whether Calendly is connected + `calendlySchedulingUrl`) so later tasks/slices can read it; map the fields in `toReadModel`. Do NOT expose token ciphertext on any read model.
- [ ] **Step 4:** Verify `npm run typecheck`, `npm run build`. Commit `feat(scheduling): clinic scheduling provider and Calendly fields`.

## Task 2: CalendlyPort + fetch adapter + env

**Files:** `src/infrastructure/config/env.schema.ts`, `src/modules/scheduling/domain/ports/calendly.port.ts` (new module), `src/modules/scheduling/infrastructure/calendly.adapter.ts`, `src/modules/scheduling/infrastructure/__tests__/calendly.adapter.spec.ts`, `src/modules/scheduling/scheduling.module.ts`.

**Interfaces produced:** `CALENDLY_PORT` symbol + `CalendlyPort`:
- `buildAuthorizeUrl(state: string): string`
- `exchangeCode(code: string): Promise<CalendlyTokens>` (`{ accessToken, refreshToken, expiresAt }`)
- `refreshToken(refreshToken: string): Promise<CalendlyTokens>`
- `getMe(accessToken: string): Promise<{ userUri: string; orgUri: string; schedulingUrl: string }>`
- `createWebhookSubscription(accessToken, orgUri, signingKey): Promise<{ webhookUri: string }>`
- `deleteWebhookSubscription(accessToken, webhookUri): Promise<void>`

- [ ] **Step 1:** Env: add `CALENDLY_CLIENT_ID`, `CALENDLY_CLIENT_SECRET`, `CALENDLY_REDIRECT_URI` (url), `CALENDLY_WEBHOOK_URL` (url), and `CALENDLY_API_BASE` (default `https://api.calendly.com`), `CALENDLY_AUTH_BASE` (default `https://auth.calendly.com`). Use `.min(1)`/`.url()` as appropriate; the four app-specific ones required, bases defaulted.
- [ ] **Step 2:** Define `CalendlyPort` + `CalendlyTokens` + the `CALENDLY_PORT` symbol in the domain file.
- [ ] **Step 3:** Implement `calendly.adapter.ts` with global `fetch`: token exchange (`POST {authBase}/oauth/token`, grant_type authorization_code / refresh_token, client id+secret), `getMe` (`GET {apiBase}/users/me` -> resource.uri, current_organization, scheduling_url), `createWebhookSubscription` (`POST {apiBase}/webhook_subscriptions` with url=CALENDLY_WEBHOOK_URL, events `['invitee.created','invitee.canceled']`, organization=orgUri, scope 'organization', signing_key), `deleteWebhookSubscription` (`DELETE {webhookUri}`). Map non-2xx to a clear domain error. `buildAuthorizeUrl` builds `{authBase}/oauth/authorize?client_id&response_type=code&redirect_uri&state`.
- [ ] **Step 4:** Unit-test the adapter with an injected `fetch` seam (constructor param defaulting to global fetch): assert request URLs/methods/bodies and response mapping for each method, plus non-2xx throwing. Do not hit the network.
- [ ] **Step 5:** Verify `npm run typecheck`, `npm run lint`, `npm run build`, `npx jest src/modules/scheduling`. Commit `feat(scheduling): Calendly API port, adapter, and env`.

## Task 3: Connect / callback / disconnect / status use-cases + endpoints

**Files:** `src/modules/scheduling/application/*` (connect-authorize-url, calendly-callback, disconnect-scheduling, get-scheduling-status use-cases + specs), a clinic repository method set for the scheduling fields, DTOs under `src/modules/scheduling/infrastructure/http/dto/`, a `SchedulingController` (or extend clinic-portal), `scheduling.module.ts` wiring, OpenAPI.

- [ ] **Step 1:** Clinic repo (or a scheduling repo) methods: `getSchedulingState(clinicId)`, `setCalendlyConnection(clinicId, {userUri, orgUri, schedulingUrl, accessTokenEnc, refreshTokenEnc, tokenExpiresAt, webhookUri, signingKeyEnc})`, `clearScheduling(clinicId)`. Use `asSystem`/existing prisma pattern.
- [ ] **Step 2:** `GetSchedulingStatusUseCase` -> `{ provider, connected, schedulingUrl }` (never returns ciphertext).
- [ ] **Step 3:** `ConnectAuthorizeUrlUseCase` -> returns `{ authorizeUrl }` using `CalendlyPort.buildAuthorizeUrl(state)`, where `state` is a signed value binding the clinicId + a nonce (reuse `EncryptionPort` to encrypt `clinicId:nonce`, or sign it) so the callback can verify.
- [ ] **Step 4:** `CalendlyCallbackUseCase(clinicId, code, state)`: verify state matches the clinic; `exchangeCode` -> tokens; `getMe` -> uris + schedulingUrl; generate a random `signingKey`; `createWebhookSubscription`; encrypt access/refresh tokens + signingKey via `EncryptionPort`; persist via `setCalendlyConnection` and set `schedulingProvider='calendly'`. Return `{ connected: true, schedulingUrl }`. On any Calendly failure, do not partially persist (no tokens saved unless the whole flow succeeds).
- [ ] **Step 5:** `DisconnectSchedulingUseCase(clinicId)`: if connected, decrypt the access token, `deleteWebhookSubscription`; then `clearScheduling` (provider back to `none`, null the calendly fields). Best-effort on the remote delete (log + proceed to clear locally if Calendly errors).
- [ ] **Step 6:** Controller under `clinic/portal/scheduling` with `ClinicGuard` + `@CurrentClinic()`: `GET /clinic/portal/scheduling` (status), `GET /clinic/portal/scheduling/calendly/authorize-url`, `POST /clinic/portal/scheduling/calendly/callback` (`{ code, state }`), `POST /clinic/portal/scheduling/disconnect`. DTOs with `@ApiProperty`. Wire everything in `scheduling.module.ts` (import CryptoModule for `EncryptionPort`, the clinic repo, `CALENDLY_PORT`).
- [ ] **Step 7:** Unit tests: callback happy-path (mocks `CalendlyPort` + encryption + repo; asserts encrypted values persisted, provider set, webhook created), state-mismatch rejection, disconnect deletes + clears, status shape has no ciphertext. `npm run openapi` to regenerate the committed spec.
- [ ] **Step 8:** Verify `npm run typecheck`, `npm run lint`, `npm run build`, `npx jest src/modules/scheduling`. Commit `feat(scheduling): Calendly connect, callback, disconnect, and status endpoints`.

## Self-Review Notes
- Tokens + signing key only ever stored encrypted; no read model or DTO returns ciphertext.
- `scheduling_provider` defaults to `none`; existing clinics are unaffected and keep request-to-book.
- The webhook subscription points at the config webhook URL; the receiver is slice 2.
- Google/other providers are out of scope; the `scheduling` module + provider field are the seam for them later.

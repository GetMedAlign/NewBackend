# Clinic Tour Video Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Let a clinic upload one tour video (max 50 MB, video only) to the separate public Supabase bucket `clinic-videos`, store its URL on the clinic, and play it on the public clinic profile. Mirrors the existing signed-URL logo/photo flow.

**Repos/branches:** Backend = `NewBackend` on `feat/clinic-video-upload` (Tasks B*). Frontend = `Medalign-frontend` on `feat/frontend-tweaks` (Tasks F*). Backend ships first (the frontend consumes its endpoints).

## Global Constraints
- One tour video per clinic; max 50 MB; content types `video/mp4`, `video/webm`, `video/quicktime`. Bucket `clinic-videos` (public, separate from the image bucket).
- Reuse the existing signed-URL pattern (`clinic-media` module: sign -> browser PUT to Supabase -> confirm). Reuse ownership guards (`assertOwnedPath`) and the `SupabaseStorageAdapter` (which already accepts a bucket).
- No em dashes in code/comments. Keep the committed OpenAPI spec updated (`npm run openapi`). Tests run in CI (jest works in subagent shells).

---

## Task B1: Video storage provider + clinic tour_video_url column

**Files (NewBackend):** `src/infrastructure/config/env.schema.ts`, `src/modules/clinic-media/clinic-media.module.ts`, `src/modules/clinic-media/domain/ports/storage.port.ts` (a new `VIDEO_STORAGE_PORT` symbol), `prisma/schema.prisma` + a migration, and the clinic read model + public-profile DTO where media URLs are exposed.

- [ ] **Step 1:** Add `SUPABASE_VIDEO_BUCKET: z.string().default('clinic-videos')` to the env schema (next to `SUPABASE_STORAGE_BUCKET`).
- [ ] **Step 2:** Add a `VIDEO_STORAGE_PORT` provider in `clinic-media.module.ts`: a second `SupabaseStorageAdapter` constructed with `bucket: config.getOrThrow('SUPABASE_VIDEO_BUCKET')` (same url + serviceRoleKey). Export it. Define the `VIDEO_STORAGE_PORT` symbol (reuse the `StoragePort` interface).
- [ ] **Step 3:** Add `tourVideoUrl String? @map("tour_video_url")` to `model Clinic`; create a migration (nullable text column, no backfill), `npx prisma generate`.
- [ ] **Step 4:** Expose `tourVideoUrl` on the clinic public-profile response (find the public clinic profile DTO/mapper used by the `/clinics/:slug` endpoint the frontend calls) and on the clinic portal profile response if that endpoint returns media. Map `null` through.
- [ ] **Step 5:** Verify `npm run typecheck`, `npm run lint`, `npm run build`. Commit `feat(clinic-media): video storage provider and clinic tour video column`.

## Task B2: Sign + confirm video endpoints

**Files (NewBackend):** `src/modules/clinic-media/application/sign-video-upload.use-case.ts` (new), `confirm-video.use-case.ts` (new), DTOs under `.../infrastructure/http/dto/`, the `clinic-media.controller.ts`, the clinic-photo (or a small clinic) repository method to set/get `tour_video_url`, tests, and OpenAPI.

- [ ] **Step 1:** `SignVideoUploadUseCase` (inject `VIDEO_STORAGE_PORT`): validate `contentType` in `['video/mp4','video/webm','video/quicktime']`; path `videos/${clinicId}/${randomUUID()}.${ext}`; return `{ uploadUrl, token, path }`. Mirror `sign-logo-upload.use-case.ts`.
- [ ] **Step 2:** `ConfirmVideoUseCase`: `assertOwnedPath(path, 'videos/${clinicId}/')`; remove the clinic's previous video (if any) via the video storage port + its stored URL; compute `publicUrl(path)` and persist it to `clinic.tour_video_url`; return `{ url }`. Mirror `confirm-logo.use-case.ts`.
- [ ] **Step 3:** DTOs (sign request `{ contentType }` with `@IsIn([...])`; confirm request `{ path }`) with `@ApiProperty`. Add controller routes `POST /clinic/portal/media/video/sign` and `POST /clinic/portal/media/video` (same auth/ownership guards + clinicId resolution as the logo/photo routes).
- [ ] **Step 4:** Wire the new use-cases into `clinic-media.module.ts` providers. Add a repository method to set/get the clinic tour video URL (extend the clinic-photo repository or add a tiny method).
- [ ] **Step 5:** Unit tests for both use-cases (content-type validation, path ownership, replace-old-video, persistence). `npm run openapi` to regenerate the committed spec.
- [ ] **Step 6:** Verify `npm run typecheck`, `npm run lint`, `npm run build`, and `npx jest src/modules/clinic-media`. Commit `feat(clinic-media): sign and confirm clinic tour video endpoints`.

---

## Task F1: Frontend upload helper + portal uploader

**Files (Medalign-frontend, `feat/frontend-tweaks`):** `app/api/clinicPortalClient.ts` (or `app/api/client.ts` + `storageUpload.ts`), and the clinic portal profile page media area (`app/routes/clinic-portal/profile.tsx` or its media section/`ClinicProfileSection`).

- [ ] **Step 1:** Add `uploadClinicVideo(file: File): Promise<string>`: client-side validate type (mp4/webm/quicktime) and size (<= 50 MB, reject with a clear message otherwise); POST `/clinic/portal/media/video/sign` with `{ contentType: file.type }`; `putToSignedUrl(uploadUrl, file)`; POST `/clinic/portal/media/video` with `{ path }`; return the `url`.
- [ ] **Step 2:** Add a "Clinic tour video" uploader to the portal profile media area: a file input (accept `video/mp4,video/webm,video/quicktime`), a busy state during upload, an inline `<video controls>` preview of the current `tourVideoUrl` when present, a Replace action, and inline error text (size/type). Reads the current video URL from the portal profile data.
- [ ] **Step 3:** Verify `npm run typecheck` and `npm run build`. Commit `feat(clinic-portal): clinic tour video uploader`.

## Task F2: Play the tour video on the public clinic profile

**Files (Medalign-frontend):** `app/routes/clinic-detail.tsx` (the media grid "Clinic tour" slot) + the `MockClinic`/public-profile type in `app/data/clinics.ts` (add `tourVideoUrl?: string | null`).

- [ ] **Step 1:** Add `tourVideoUrl?: string | null` to the public clinic profile type so the API field is carried through.
- [ ] **Step 2:** In the media grid, if `clinic.tourVideoUrl` is present, render an inline `<video controls preload="metadata" className="...">` (using the existing "Clinic tour" tile styling) instead of the `DemoVideo` placeholder; keep the placeholder when absent. Do not autoplay.
- [ ] **Step 3:** Verify `npm run typecheck` and `npm run build`. Manual: a clinic with a `tourVideoUrl` shows a playable video on `/clinic/:slug`; one without shows the placeholder. Commit `feat(clinic): play tour video on the public clinic profile`.

## Self-Review Notes
- Videos use a separate public bucket `clinic-videos`; images are untouched.
- One video per clinic (confirm replaces the previous file + URL).
- 50 MB + mime enforced client-side and validated server-side (content type).
- tourVideoUrl is nullable end to end; existing clinics/profiles keep working.

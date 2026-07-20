import type { AdminCtx } from '../../../../infrastructure/security/admin-ctx';
import type { AdminNote } from '../../infrastructure/http/dto/admin-note.dto';

export interface AdminNoteRepositoryPort {
  /** Returns all notes for a clinic ordered by created_at DESC (spec §1.5). */
  listNotes(ctx: AdminCtx, clinicId: string): Promise<AdminNote[]>;

  /**
   * Inserts a note. `author_user_id` is always `ctx.userId`; `author_name`
   * is resolved from that user's `users.name` (falling back to `'Admin'`)
   * and stored denormalized so the note survives the author's account being
   * removed. The caller-supplied body is never used to derive authorship.
   */
  addNote(ctx: AdminCtx, clinicId: string, body: string): Promise<AdminNote>;

  /** Returns `users.name` for the given user id, or null if unset/absent. */
  getAuthorName(ctx: AdminCtx, userId: string): Promise<string | null>;
}

export const ADMIN_NOTE_REPOSITORY = Symbol('AdminNoteRepositoryPort');

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { AdminCtx } from '../../../infrastructure/security/admin-ctx';
import { resolveAuthorName } from '../domain/resolve-author-name';
import type { AdminNoteRepositoryPort } from '../domain/ports/admin-note-repository.port';
import type { AdminNote } from './http/dto/admin-note.dto';

type NoteRow = { id: string; created_at: Date; author_name: string; body: string };
type NameRow = { name: string | null };

@Injectable()
export class PrismaAdminNoteRepository implements AdminNoteRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async listNotes(ctx: AdminCtx, clinicId: string): Promise<AdminNote[]> {
    return this.prisma.withUserContext(
      { userId: ctx.userId, role: ctx.role, ip: ctx.ip },
      async (tx) => {
        const rows = await tx.$queryRaw<NoteRow[]>`
          SELECT id, created_at AS "created_at", author_name AS "author_name", body
            FROM admin_notes
           WHERE clinic_id = ${clinicId}::uuid
           ORDER BY created_at DESC`;
        return rows.map(toAdminNote);
      },
    );
  }

  async addNote(ctx: AdminCtx, clinicId: string, body: string): Promise<AdminNote> {
    // Author identity comes only from the token (ctx.userId), never the
    // request body. Resolved and denormalized here so the note survives the
    // author's account being removed later.
    const rawName = await this.getAuthorName(ctx, ctx.userId);
    const authorName = resolveAuthorName(rawName);

    return this.prisma.withUserContext(
      { userId: ctx.userId, role: ctx.role, ip: ctx.ip },
      async (tx) => {
        const rows = await tx.$queryRaw<NoteRow[]>`
          INSERT INTO admin_notes (clinic_id, author_user_id, author_name, body)
          VALUES (${clinicId}::uuid, ${ctx.userId}::uuid, ${authorName}, ${body})
          RETURNING id, created_at AS "created_at", author_name AS "author_name", body`;
        return toAdminNote(rows[0]!);
      },
    );
  }

  async getAuthorName(ctx: AdminCtx, userId: string): Promise<string | null> {
    return this.prisma.withUserContext(
      { userId: ctx.userId, role: ctx.role, ip: ctx.ip },
      async (tx) => {
        const rows = await tx.$queryRaw<NameRow[]>`
          SELECT name FROM users WHERE id = ${userId}::uuid`;
        return rows[0]?.name ?? null;
      },
    );
  }
}

function toAdminNote(row: NoteRow): AdminNote {
  return {
    id: row.id,
    createdAt: row.created_at.toISOString(),
    authorName: row.author_name,
    body: row.body,
  };
}

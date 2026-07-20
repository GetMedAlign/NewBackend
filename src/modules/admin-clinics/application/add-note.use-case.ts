import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AdminCtx } from '../../../infrastructure/security/admin-ctx';
import { ADMIN_CLINIC_REPOSITORY } from '../domain/ports/admin-clinic-repository.port';
import type { AdminClinicRepositoryPort } from '../domain/ports/admin-clinic-repository.port';
import { ADMIN_NOTE_REPOSITORY } from '../domain/ports/admin-note-repository.port';
import type { AdminNoteRepositoryPort } from '../domain/ports/admin-note-repository.port';
import type { AdminNote } from '../infrastructure/http/dto/admin-note.dto';

/**
 * Authorship (`author_user_id` / `author_name`) is resolved by the
 * repository from `ctx.userId` — never from the request body — so it is
 * structurally impossible for a caller to spoof it (spec §1.6).
 */
@Injectable()
export class AddNoteUseCase {
  constructor(
    @Inject(ADMIN_CLINIC_REPOSITORY)
    private readonly clinicRepo: AdminClinicRepositoryPort,
    @Inject(ADMIN_NOTE_REPOSITORY)
    private readonly noteRepo: AdminNoteRepositoryPort,
  ) {}

  async execute(ctx: AdminCtx, clinicId: string, body: string): Promise<AdminNote> {
    const exists = await this.clinicRepo.clinicExists(ctx, clinicId);
    if (!exists) throw new NotFoundException('Clinic not found.');
    return this.noteRepo.addNote(ctx, clinicId, body);
  }
}

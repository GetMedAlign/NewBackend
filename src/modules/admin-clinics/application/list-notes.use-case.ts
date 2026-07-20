import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AdminCtx } from '../../../infrastructure/security/admin-ctx';
import { ADMIN_CLINIC_REPOSITORY } from '../domain/ports/admin-clinic-repository.port';
import type { AdminClinicRepositoryPort } from '../domain/ports/admin-clinic-repository.port';
import { ADMIN_NOTE_REPOSITORY } from '../domain/ports/admin-note-repository.port';
import type { AdminNoteRepositoryPort } from '../domain/ports/admin-note-repository.port';
import type { AdminNote } from '../infrastructure/http/dto/admin-note.dto';

@Injectable()
export class ListNotesUseCase {
  constructor(
    @Inject(ADMIN_CLINIC_REPOSITORY)
    private readonly clinicRepo: AdminClinicRepositoryPort,
    @Inject(ADMIN_NOTE_REPOSITORY)
    private readonly noteRepo: AdminNoteRepositoryPort,
  ) {}

  async execute(ctx: AdminCtx, clinicId: string): Promise<AdminNote[]> {
    const exists = await this.clinicRepo.clinicExists(ctx, clinicId);
    if (!exists) throw new NotFoundException('Clinic not found.');
    return this.noteRepo.listNotes(ctx, clinicId);
  }
}

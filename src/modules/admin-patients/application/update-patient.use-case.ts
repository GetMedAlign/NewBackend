import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AdminCtx } from '../../../infrastructure/security/admin-ctx';
import { ADMIN_PATIENT_REPOSITORY } from '../domain/ports/admin-patient-repository.port';
import type {
  AdminPatientRepositoryPort,
  UpdatePatientInput,
} from '../domain/ports/admin-patient-repository.port';

/**
 * Strips a field from a partial input when its value is undefined or null,
 * matching "absent leaves the column unchanged" semantics (spec §1.8).
 */
function present<T>(value: T | null | undefined): value is T {
  return value !== undefined && value !== null;
}

@Injectable()
export class UpdatePatientUseCase {
  constructor(
    @Inject(ADMIN_PATIENT_REPOSITORY)
    private readonly repo: AdminPatientRepositoryPort,
  ) {}

  async execute(
    ctx: AdminCtx,
    patientId: string,
    input: UpdatePatientInput,
  ): Promise<{ success: true }> {
    const sanitized: UpdatePatientInput = {};

    if (present(input.name)) sanitized.name = input.name;
    if (present(input.zipCode)) sanitized.zipCode = input.zipCode;
    // An unparseable dob is dropped rather than rejected, matching .NET's
    // DateOnly.TryParse guard (spec §1.8) — do not throw here.
    if (present(input.dob) && !Number.isNaN(Date.parse(input.dob))) {
      sanitized.dob = input.dob;
    }

    const result = await this.repo.updatePatient(ctx, patientId, sanitized);
    if (result === 'not_found') throw new NotFoundException('Patient not found.');
    if (result === 'already_deleted') throw new ConflictException('Patient already deleted.');
    return { success: true };
  }
}

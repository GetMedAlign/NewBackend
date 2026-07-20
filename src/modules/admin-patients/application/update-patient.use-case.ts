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

const DOB_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True only for strings the `date` column will actually accept, mirroring
 * .NET's `DateOnly.TryParse` (spec §1.8). `Date.parse`/`new Date(string)` is
 * too permissive on its own: it accepts non-`YYYY-MM-DD` shapes (e.g. "2020")
 * and silently rolls over out-of-range days (e.g. "2020-02-30" -> Mar 1),
 * both of which the Postgres `::date` cast rejects with a driver error. This
 * requires the strict shape AND a round-trip check so rolled-over dates are
 * rejected rather than reaching the database.
 */
function isValidDobString(dob: string): boolean {
  if (!DOB_SHAPE.test(dob)) return false;

  const [yearStr, monthStr, dayStr] = dob.split('-') as [string, string, string];
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
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
    if (present(input.dob) && isValidDobString(input.dob)) {
      sanitized.dob = input.dob;
    }

    const result = await this.repo.updatePatient(ctx, patientId, sanitized);
    if (result === 'not_found') throw new NotFoundException('Patient not found.');
    if (result === 'already_deleted') throw new ConflictException('Patient already deleted.');
    return { success: true };
  }
}

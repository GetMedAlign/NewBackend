import type { AdminCtx } from '../../../../infrastructure/security/admin-ctx';
import type { AdminPatientDto } from '../patient-dto.mapper';

/**
 * The exact sentinel written to `users.locked_until` on soft delete (spec
 * §3.3). Use this literal rather than Postgres `infinity`, which does not
 * round-trip cleanly through Prisma's `DateTime`.
 */
export const DELETED_LOCK_UNTIL = new Date('9999-12-31T23:59:59.000Z');

/**
 * Body of `PUT /admin/patients/:id`. All fields optional; `name` writes
 * `users.name` for the patient's user, `dob` and `zipCode` write `patients`
 * columns (spec §1.8).
 */
export interface UpdatePatientInput {
  name?: string;
  dob?: string;
  zipCode?: string;
}

/**
 * Outcome of a patient write. `'not_found'` and `'already_deleted'` are
 * translated by the use case into 404 and 409 respectively.
 */
export type PatientWriteResult = 'ok' | 'not_found' | 'already_deleted';

export interface AdminPatientRepositoryPort {
  /**
   * Returns every patient (including soft-deleted ones, flagged by
   * `isDeleted`) ordered by `created_at` DESC, under admin RLS.
   */
  listPatients(ctx: AdminCtx): Promise<AdminPatientDto[]>;

  /** Returns a single patient by id, or null if it does not exist (or is hidden by RLS). */
  getPatient(ctx: AdminCtx, patientId: string): Promise<AdminPatientDto | null>;

  /**
   * Partially updates a patient. Checks existence and deleted-state first,
   * inside the same transaction as the writes (spec §1.8).
   */
  updatePatient(
    ctx: AdminCtx,
    patientId: string,
    input: UpdatePatientInput,
  ): Promise<PatientWriteResult>;

  /**
   * Soft-deletes a patient: marks the patient row deleted and locks the
   * patient's user out via `DELETED_LOCK_UNTIL`, in one transaction (spec
   * §3.3). Terminal — there is no restore endpoint.
   */
  softDeletePatient(ctx: AdminCtx, patientId: string): Promise<PatientWriteResult>;
}

export const ADMIN_PATIENT_REPOSITORY = Symbol('AdminPatientRepositoryPort');

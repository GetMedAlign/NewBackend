import type { AdminCtx } from '../../../../infrastructure/security/admin-ctx';
import type { AdminPatientDto } from '../patient-dto.mapper';

export interface AdminPatientRepositoryPort {
  /**
   * Returns every patient (including soft-deleted ones, flagged by
   * `isDeleted`) ordered by `created_at` DESC, under admin RLS.
   */
  listPatients(ctx: AdminCtx): Promise<AdminPatientDto[]>;

  /** Returns a single patient by id, or null if it does not exist (or is hidden by RLS). */
  getPatient(ctx: AdminCtx, patientId: string): Promise<AdminPatientDto | null>;
}

export const ADMIN_PATIENT_REPOSITORY = Symbol('AdminPatientRepositoryPort');

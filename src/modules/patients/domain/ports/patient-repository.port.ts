export interface PatientProfile {
  name: string | null;
  email: string;
  dob: Date | null;
  zipCode: string | null;
  isDeleted: boolean;
  hasPatient: boolean;
}

export interface PatientRepositoryPort {
  findProfile(userId: string): Promise<PatientProfile | null>;
  updateProfile(userId: string, data: { name: string; dob?: string }): Promise<void>;
  /**
   * Resolves the authenticated user's own patient id directly by user id,
   * regardless of whether they have any (claimed) assessment. RLS-scoped so a
   * caller can only ever read their own patient row.
   */
  findPatientIdByUserId(userId: string): Promise<string | null>;
  /**
   * Soft-deletes the authenticated user's own patient record (is_deleted +
   * deleted_at) and locks the user account, in one transaction scoped to the
   * caller's own user id. Returns 'not_found' when the user has no patient
   * record, 'already_deleted' if it was already soft-deleted, 'ok' otherwise.
   */
  softDeleteSelf(userId: string): Promise<'ok' | 'not_found' | 'already_deleted'>;
}

export const PATIENT_REPOSITORY = Symbol('PatientRepositoryPort');

import { formatDateOnly } from '../../../infrastructure/format/date';

/**
 * Raw row shape produced by the §1.7 query: patient columns joined to the
 * owning user's name/email, plus two correlated-subquery columns
 * (`treatment_category` of the latest assessment, `match_count` of leads).
 *
 * `treatment_category` is a plain Postgres enum column — never an encrypted
 * assessment field. This module must never select ciphertext.
 */
export interface AdminPatientRow {
  id: string;
  name: string | null;
  email: string;
  date_of_birth: Date | null;
  zip_code: string | null;
  created_at: Date;
  last_assessment_at: Date | null;
  treatment_category: string | null;
  match_count: number;
  is_deleted: boolean;
  deleted_at: Date | null;
}

/** The exact eleven fields exposed by GET /admin/patients and GET /admin/patients/:id. */
export interface AdminPatientDto {
  id: string;
  name: string;
  email: string;
  dob: string | null;
  zipCode: string;
  createdAt: string;
  lastAssessmentAt: string | null;
  treatmentCategory: string | null;
  matchCount: number;
  isDeleted: boolean;
  deletedAt: string | null;
}

export function toAdminPatientDto(row: AdminPatientRow): AdminPatientDto {
  return {
    id: row.id,
    name: row.name ?? row.email ?? '',
    email: row.email,
    dob: formatDateOnly(row.date_of_birth),
    zipCode: row.zip_code ?? '',
    createdAt: formatDateOnly(row.created_at) as string,
    lastAssessmentAt: formatDateOnly(row.last_assessment_at),
    treatmentCategory: row.treatment_category,
    matchCount: row.match_count,
    isDeleted: row.is_deleted,
    deletedAt: formatDateOnly(row.deleted_at),
  };
}

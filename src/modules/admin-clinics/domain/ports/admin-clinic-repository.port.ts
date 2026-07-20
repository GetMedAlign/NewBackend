import type { AdminCtx } from '../../../../infrastructure/security/admin-ctx';
import type { AdminClinicDto } from '../clinic-dto.mapper';

export interface AdminClinicRepositoryPort {
  /** Returns all clinics ordered by name ASC, under admin RLS. */
  listClinics(ctx: AdminCtx): Promise<AdminClinicDto[]>;

  /** Returns a single clinic by id, or null if it does not exist (or is hidden by RLS). */
  getClinic(ctx: AdminCtx, clinicId: string): Promise<AdminClinicDto | null>;
}

export const ADMIN_CLINIC_REPOSITORY = Symbol('AdminClinicRepositoryPort');

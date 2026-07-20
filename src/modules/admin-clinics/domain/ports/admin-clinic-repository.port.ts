import type { AdminCtx } from '../../../../infrastructure/security/admin-ctx';
import type { AdminClinicDto } from '../clinic-dto.mapper';
import type { AdminLeadRow } from '../../infrastructure/http/dto/admin-lead-row.dto';

/**
 * Partial update payload for PUT /admin/clinics/:id. A field that is absent
 * or null leaves the corresponding column unchanged.
 */
export interface UpdateClinicInput {
  name?: string;
  status?: string;
  about?: string;
  differentiators?: string;
  providerName?: string;
  credentials?: string;
  websiteUrl?: string;
  city?: string;
  stateCode?: string;
  zipCode?: string;
  telehealth?: boolean;
  offersLabWork?: boolean;
  financing?: boolean;
  insurance?: boolean;
  insuranceNotes?: string;
  consultationFee?: string;
  monthlyProgram?: string;
  waitTime?: string;
  rating?: number;
  reviewCount?: number;
  isListedInDirectory?: boolean;
  logoUrl?: string;
}

export interface AdminClinicRepositoryPort {
  /** Returns all clinics ordered by name ASC, under admin RLS. */
  listClinics(ctx: AdminCtx): Promise<AdminClinicDto[]>;

  /** Returns a single clinic by id, or null if it does not exist (or is hidden by RLS). */
  getClinic(ctx: AdminCtx, clinicId: string): Promise<AdminClinicDto | null>;

  /** Partial update of a clinic. Returns false when the clinic does not exist. */
  updateClinic(ctx: AdminCtx, clinicId: string, input: UpdateClinicInput): Promise<boolean>;

  /** Sets/clears delivery pause per spec §1.3. Returns false when the clinic does not exist. */
  pauseDelivery(ctx: AdminCtx, clinicId: string, paused: boolean): Promise<boolean>;

  /** Returns true when a clinic with this id exists (under admin RLS). */
  clinicExists(ctx: AdminCtx, clinicId: string): Promise<boolean>;

  /** Returns all leads for a clinic ordered by received_at DESC (spec §1.4). */
  listClinicLeads(ctx: AdminCtx, clinicId: string): Promise<AdminLeadRow[]>;
}

export const ADMIN_CLINIC_REPOSITORY = Symbol('AdminClinicRepositoryPort');

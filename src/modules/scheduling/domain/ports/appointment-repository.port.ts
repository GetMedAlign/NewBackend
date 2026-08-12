export type AppointmentStatus = 'booked' | 'canceled';

export type CreateAppointmentInput = {
  clinicId: string;
  /**
   * The lead's public identifier (`Lead.leadId`, e.g. `lead_<hex>`), NOT the
   * internal `Lead.id` uuid. Null when the webhook could not resolve a lead
   * (no/mismatched tracking token and no matching lead by email).
   */
  leadId: string | null;
  /**
   * The patient's internal id, resolved from the linked lead's `patientId`
   * attribution link. Null when the lead couldn't be resolved or the lead
   * itself has no patientId (anonymous submission).
   */
  patientId?: string | null;
  inviteeEmail: string;
  inviteeName: string | null;
  calendlyEventUri: string;
  calendlyInviteeUri: string;
  startTime: Date;
  endTime: Date | null;
  status: AppointmentStatus;
};

export type AppointmentRecord = {
  id: string;
  clinicId: string;
  /** The lead's public identifier (`Lead.leadId`), or null if unlinked. */
  leadId: string | null;
  patientId: string | null;
  sessionId: string | null;
  inviteeEmail: string;
  inviteeName: string | null;
  calendlyEventUri: string;
  calendlyInviteeUri: string;
  startTime: Date;
  endTime: Date | null;
  status: AppointmentStatus;
  createdAt: Date;
  updatedAt: Date;
};

export interface AppointmentRepositoryPort {
  /**
   * Idempotent insert keyed on `calendlyInviteeUri`: a redelivery of the
   * same `invitee.created` event no-ops instead of throwing or duplicating
   * the row.
   */
  createIfAbsent(input: CreateAppointmentInput): Promise<void>;

  /**
   * Sets `status = 'canceled'` (and bumps `updated_at`) for the appointment
   * with this invitee URI. No-ops (does not throw) if no matching
   * appointment exists, so a redelivered/unknown cancellation is safe.
   */
  cancelByInviteeUri(calendlyInviteeUri: string): Promise<void>;

  /** Returns the linked lead's public id for an appointment, or null if none/not found. */
  findLeadIdByInviteeUri(calendlyInviteeUri: string): Promise<string | null>;

  /** All appointments for a clinic, most recent start time first. */
  listForClinic(clinicId: string): Promise<AppointmentRecord[]>;

  /** All appointments linked to a patient (by patientId or anonymous sessionId), most recent start time first. */
  listForPatient(params: { patientId: string; sessionId: string }): Promise<AppointmentRecord[]>;
}

export const APPOINTMENT_REPOSITORY = Symbol('AppointmentRepositoryPort');

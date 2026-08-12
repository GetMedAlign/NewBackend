/**
 * Snapshot fields written verbatim onto the lead row from the request.
 * `assessmentId` / `patientId` are attribution links and MUST only be set
 * when proven (see SubmitLeadUseCase), otherwise null.
 */
export interface LeadCreateInput {
  clinicId: string;
  assessmentId: string | null;
  patientId: string | null;
  patientFirstName: string;
  patientEmail: string;
  patientZip: string | null;
  treatmentCategory: string;
  topGoals: string | null;
  topSymptoms: string | null;
  budgetBand: string | null;
  telehealthPreference: string | null;
  appointmentPreference: string | null;
  startTimeline: string | null;
  patientPhone: string | null;
}

export type LeadDeliveryStatus = 'pending' | 'emailed' | 'sent_to_crm' | 'failed';

export interface WebhookDeliveryRecord {
  url: string;
  status: 'success' | 'failed';
  responseCode?: number | null;
  error?: string | null;
}

/**
 * A patient-facing view of one of the caller's own leads. Returned by
 * `findByPatientUser`, which runs RLS-scoped via `withUserContext`.
 */
export interface PatientLeadView {
  leadId: string;
  clinicId: string;
  clinicName: string;
  clinicSlug: string;
  clinicCategory: string;
  websiteUrl: string | null;
  submittedAt: Date;
  treatmentCategory: string;
  topGoals: string[];
  topSymptoms: string[];
  budgetBand: string | null;
  telehealthPreference: string | null;
  startTimeline: string | null;
  appointmentPreference: string | null;
}

export interface LeadRepositoryPort {
  /**
   * Creates a lead (`lead_<32 hex>`), encrypting `patientPhone` if present.
   * Runs via `asSystem` since leads may be anonymous.
   */
  create(data: LeadCreateInput): Promise<{ leadId: string }>;

  /** Inserts a `webhook_deliveries` row for the given lead. */
  recordDelivery(leadId: string, record: WebhookDeliveryRecord): Promise<void>;

  /** Sets `delivery_status` and (optionally) `delivered_at` on the lead. */
  setDeliveryStatus(leadId: string, status: LeadDeliveryStatus, deliveredAt?: Date): Promise<void>;

  /** Returns the caller's own leads, RLS-scoped via `withUserContext`. */
  findByPatientUser(userId: string): Promise<PatientLeadView[]>;

  /**
   * Marks a lead booked from the Calendly webhook: sets `clinicStatus =
   * 'booked'` and `scheduledAt`. Runs via `asSystem` (the webhook request
   * carries no user/clinic session).
   */
  setBookedScheduled(leadId: string, scheduledAt: Date): Promise<void>;

  /**
   * Reverts a booking when Calendly reports `invitee.canceled`: clears
   * `scheduledAt` and sets `clinicStatus` back to `'contacted'` (not
   * `'new'`): a lead that reached booking had already been engaged by the
   * clinic, so `'new'` would misrepresent its history. Runs via `asSystem`.
   */
  revertBooking(leadId: string): Promise<void>;

  /**
   * Fallback lead resolution for the Calendly webhook when the booking's
   * tracking token is absent or unresolvable: the most recently received
   * lead for this clinic + invitee email, or null if none. Runs via
   * `asSystem`.
   */
  findLatestByClinicAndEmail(clinicId: string, patientEmail: string): Promise<{ leadId: string } | null>;

  /**
   * Returns the `patientId` attribution link stored on the lead, or null if
   * the lead has none (anonymous submission) or doesn't exist. Runs via
   * `asSystem`.
   */
  findPatientIdByLeadId(leadId: string): Promise<string | null>;
}

export const LEAD_REPOSITORY = Symbol('LeadRepositoryPort');

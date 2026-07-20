/**
 * Row returned by GET /admin/clinics/:id/leads (spec §1.4).
 *
 * DELIBERATELY MIXED CASE — do not normalize. `lead_id`, `received_at`,
 * `delivery_status`, and `clinic_status` are snake_case; `patientFirstName`,
 * `patientEmail`, `patientZip`, and `treatmentCategory` are camelCase. This
 * matches the TypeScript interface the existing frontend already binds to,
 * and mirrors the .NET DTO's explicit `[JsonPropertyName]` attributes.
 */
export interface AdminLeadRow {
  lead_id: string;
  received_at: string;
  patientFirstName: string;
  patientEmail: string;
  /** Empty string when the underlying column is null (spec §1.4). */
  patientZip: string;
  treatmentCategory: string;
  delivery_status: string;
  clinic_status: string;
}

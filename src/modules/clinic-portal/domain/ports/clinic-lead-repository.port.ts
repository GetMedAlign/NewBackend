export type ClinicLeadView = {
  id: string;
  leadId: string;
  receivedAt: Date;
  leadSource: string;
  patientFirstName: string;
  patientEmail: string;
  patientZip: string | null;
  treatmentCategory: string;
  topGoals: string | null;
  topSymptoms: string | null;
  budgetBand: string | null;
  telehealthPreference: string | null;
  startTimeline: string | null;
  deliveryStatus: string;
  clinicStatus: string;
  clinicId: string;
  clinicName: string;
  clinicWebsiteUrl: string | null;
};

export const CLINIC_LEAD_REPOSITORY = Symbol('ClinicLeadRepositoryPort');

export interface ClinicLeadRepositoryPort {
  listByClinic(clinicId: string): Promise<ClinicLeadView[]>;
  findByClinic(clinicId: string, leadId: string): Promise<ClinicLeadView | null>;
  updateStatus(clinicId: string, leadId: string, status: string): Promise<boolean>;
}

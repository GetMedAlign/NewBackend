export type ClinicServiceView = {
  serviceCode: string;
  isTopService: boolean;
  displayOrder: number;
};

export type ClinicProfileView = {
  id: string;
  slug: string;
  name: string;
  about: string | null;
  providerName: string | null;
  websiteUrl: string | null;
  city: string | null;
  stateCode: string | null;
  zipCode: string | null;
  location: string | null;
  businessEmail: string | null;
  webhookUrl: string | null;
  /** Raw ciphertext -- never exposed in HTTP response; used only to check if configured. */
  webhookSecret: string | null;
  notifyOnLead: boolean;
  differentiators: string | null;
  offersLabWork: boolean;
  insuranceNotes: string | null;
  credentials: string | null;
  npiNumber: string | null;
  stateLicenseNumber: string | null;
  logoUrl: string | null;
  photoCount: number;
  weeklySummary: boolean;
  webhookHealth: string;
  billingStatus: string;
  suspensionReason: string | null;
  telehealthAvailable: boolean;
  newPatientWait: string | null;
  consultationFeeBand: string | null;
  monthlyProgramBand: string | null;
  financingAvailable: boolean;
  acceptsInsurance: boolean;
  rating: number;
  reviewCount: number;
  treatmentCategories: string[];
  services: ClinicServiceView[];
  leadCount: number;
  lastLeadAt: Date | null;
};

export type UpdateClinicProfilePatch = {
  name?: string;
  about?: string;
  providerName?: string;
  websiteUrl?: string;
  city?: string;
  stateCode?: string;
  zipCode?: string;
  businessEmail?: string;
  webhookUrl?: string | null;
  notifyOnLead?: boolean;
  differentiators?: string;
  offersLabWork?: boolean;
  insuranceNotes?: string;
  credentials?: string;
  npiNumber?: string;
  stateLicenseNumber?: string;
  weeklySummary?: boolean;
  telehealthAvailable?: boolean;
  newPatientWait?: string;
  consultationFeeBand?: string;
  monthlyProgramBand?: string;
  financingAvailable?: boolean;
  acceptsInsurance?: boolean;
  treatmentCategories?: string[];
  topServices?: string[];
  allServices?: string[];
};

export const CLINIC_WRITE_REPOSITORY = Symbol('ClinicWriteRepositoryPort');

export interface ClinicWriteRepositoryPort {
  findProfile(clinicId: string): Promise<ClinicProfileView | null>;
  updateProfile(clinicId: string, patch: UpdateClinicProfilePatch): Promise<void>;
}

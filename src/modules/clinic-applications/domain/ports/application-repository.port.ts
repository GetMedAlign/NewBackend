export interface SubmitApplicationServiceInput {
  serviceCode: string;
  isTopService: boolean;
  displayOrder: number;
}

export interface SubmitApplicationInput {
  clinicName: string;
  contactEmail: string;
  businessEmail?: string | null;
  city?: string | null;
  stateCode?: string | null;
  zipCode?: string | null;
  websiteUrl?: string | null;
  telehealthAvailable?: boolean;
  offersLabWork?: boolean;
  newPatientWait?: string | null;
  npiNumber?: string | null;
  stateLicenseNumber?: string | null;
  consultationFeeBand?: string | null;
  monthlyProgramBand?: string | null;
  financingAvailable?: boolean;
  insuranceAccepted?: boolean;
  insuranceNotes?: string | null;
  about?: string | null;
  differentiators?: string | null;
  providerName?: string | null;
  credentials?: string | null;
  logoUrl?: string | null;
  photoUrls?: string[] | null;
  categories: string[];
  services: SubmitApplicationServiceInput[];
}

export interface ApplicationRepositoryPort {
  /**
   * Inserts a clinic_applications row (status='pending') and its
   * application_categories + application_services rows in a single asSystem
   * interactive transaction.
   */
  create(input: SubmitApplicationInput): Promise<{ applicationId: string }>;
}

export const APPLICATION_REPOSITORY = Symbol('ApplicationRepositoryPort');

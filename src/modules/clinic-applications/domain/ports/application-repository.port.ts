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

/** Admin read context passed to all admin repo methods. */
export interface AdminReadCtx {
  userId: string;
  role: string;
}

/** Lightweight summary row returned by the admin list endpoint. */
export interface ApplicationSummary {
  id: string;
  clinicName: string;
  contactEmail: string;
  city: string | null;
  stateCode: string | null;
  status: string;
  createdAt: Date;
  reviewedAt: Date | null;
}

/** Service entry inside an ApplicationDetail. */
export interface ApplicationServiceItem {
  serviceCode: string;
  isTopService: boolean;
  displayOrder: number;
}

/** Full application row including categories and services. */
export interface ApplicationDetail {
  id: string;
  clinicName: string;
  contactEmail: string;
  businessEmail: string | null;
  city: string | null;
  stateCode: string | null;
  zipCode: string | null;
  websiteUrl: string | null;
  telehealthAvailable: boolean;
  offersLabWork: boolean;
  newPatientWait: string | null;
  npiNumber: string | null;
  stateLicenseNumber: string | null;
  consultationFeeBand: string | null;
  monthlyProgramBand: string | null;
  financingAvailable: boolean;
  insuranceAccepted: boolean;
  insuranceNotes: string | null;
  about: string | null;
  differentiators: string | null;
  providerName: string | null;
  credentials: string | null;
  logoUrl: string | null;
  photoUrls: string[] | null;
  status: string;
  createdAt: Date;
  reviewedAt: Date | null;
  categories: string[];
  services: ApplicationServiceItem[];
}

export interface ApplicationRepositoryPort {
  /**
   * Inserts a clinic_applications row (status='pending') and its
   * application_categories + application_services rows in a single asSystem
   * interactive transaction.
   */
  create(input: SubmitApplicationInput): Promise<{ applicationId: string }>;

  /**
   * Returns all applications ordered by created_at DESC, under admin RLS.
   * Non-admin context returns an empty array (RLS enforces this).
   */
  list(ctx: AdminReadCtx): Promise<ApplicationSummary[]>;

  /**
   * Returns the full application row with categories and services,
   * or null if it does not exist (or is hidden by RLS).
   */
  findById(ctx: AdminReadCtx, id: string): Promise<ApplicationDetail | null>;
}

export const APPLICATION_REPOSITORY = Symbol('ApplicationRepositoryPort');

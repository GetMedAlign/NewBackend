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

/** Result of a successful approval provisioning transaction. */
export interface ApproveResult {
  clinicId: string;
  clinicUserId: string;
  loginEmail: string;
}

/** Result of a successful denial. */
export interface DenyResult {
  contactEmail: string;
  clinicName: string;
}

/**
 * Sentinels returned by approve/deny for the not-found and already-reviewed
 * cases. The status/existence checks run inside the provisioning transaction to
 * avoid races, so they are surfaced as return values rather than thrown here.
 */
export type ReviewFailure = 'not_found' | 'already_reviewed';

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

  /**
   * Atomically provisions a clinic (record + categories + services + photos) and
   * its portal login user, then marks the application approved, all inside ONE
   * admin `withUserContext` transaction. Token issuance + emails happen after
   * this returns. Returns 'not_found'/'already_reviewed' for the guard cases
   * (checked inside the tx to avoid races).
   */
  approve(ctx: AdminReadCtx, applicationId: string): Promise<ApproveResult | ReviewFailure>;

  /**
   * Marks the application denied with a reason + review metadata, inside the
   * admin `withUserContext` transaction. Provisions nothing. Returns
   * 'not_found'/'already_reviewed' for the guard cases.
   */
  deny(
    ctx: AdminReadCtx,
    applicationId: string,
    denyReason: string | null,
    adminId: string,
  ): Promise<DenyResult | ReviewFailure>;
}

export const APPLICATION_REPOSITORY = Symbol('ApplicationRepositoryPort');

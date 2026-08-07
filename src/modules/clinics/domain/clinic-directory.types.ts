/**
 * Read models and filter/result shapes for the public clinic directory
 * (GET /clinics) and public clinic profile (GET /clinics/:slug).
 *
 * Kept separate from `ClinicReadModel` (clinic.entity.ts) because that type
 * is the matching/lead-delivery read model (includes billing/webhook
 * internals) — these types expose only already-public, listable columns.
 */

/** Valid `sortBy` values for the directory listing. Mirrors the .NET switch. */
export type ClinicDirectorySortBy = 'rating' | 'name' | 'reviews' | 'distance';

export interface ClinicDirectoryFilter {
  category?: string;
  state?: string;
  telehealth?: boolean;
  serviceCode?: string;
  search?: string;
  sortBy: ClinicDirectorySortBy;
  page: number;
  pageSize: number;
  /** Resolved from `zipCode` via ZipGeocoder; null when no zipCode given or lookup failed. */
  patientLat: number | null;
  patientLng: number | null;
}

/** A single row of the paginated directory listing. */
export interface ClinicDirectoryRow {
  id: string;
  slug: string;
  name: string;
  /** Primary category (first `clinic_categories` row); "wellness" when none. */
  category: string;
  city: string | null;
  stateCode: string | null;
  rating: number;
  reviewCount: number;
  telehealthAvailable: boolean;
  /** Up to 3 service codes flagged `is_top_service`, ordered by `display_order`. */
  topServices: string[];
  consultationFeeBand: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
  /** Miles from the resolved patient ZIP, rounded to 1 decimal; null when unknown. */
  distanceMiles: number | null;
}

export interface ClinicDirectoryQueryResult {
  items: ClinicDirectoryRow[];
  totalCount: number;
}

/** Full read model for the public single-clinic profile (GET /clinics/:slug). */
export interface ClinicProfileReadModel {
  id: string;
  slug: string;
  name: string;
  category: string;
  location: string | null;
  city: string | null;
  stateCode: string | null;
  zipCode: string | null;
  rating: number;
  reviewCount: number;
  about: string;
  differentiators: string;
  providerName: string;
  credentials: string;
  /** Service codes flagged `is_top_service`, ordered by `display_order`. */
  topServices: string[];
  /** All service codes, top services first, then the rest, each by `display_order`. */
  allServices: string[];
  waitTime: string;
  telehealthAvailable: boolean;
  offersLabWork: boolean;
  websiteUrl: string | null;
  consultationFeeBand: string;
  monthlyProgramBand: string;
  financingAvailable: boolean;
  acceptsInsurance: boolean;
  photoCount: number;
  logoUrl: string | null;
  tourVideoUrl: string | null;
  /** Photo URLs ordered by `display_order`. */
  photoUrls: string[];
}

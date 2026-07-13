/**
 * Data transfer object for a single clinic recommendation result.
 * No PHI — only clinic-level data is included.
 * `clinicId` is the clinic's UUID string (the .NET service uses an int id;
 * the TypeScript rebuild uses uuids throughout).
 */
export interface ClinicMatchDto {
  /** UUID of the matched clinic. */
  clinicId: string;
  slug: string;
  name: string;
  /** Integer score (sum of 7 scoring components). */
  score: number;
  /** "City, State" or best-effort string when city/state is null. */
  location: string;
  rating: number;
  reviewCount: number;
  /** Service codes (all services from the clinic). */
  topServices: string[];
  categories: string[];
  telehealthAvailable: boolean;
  newPatientWait: string;
  consultationFeeBand: string;
  monthlyProgramBand: string;
  financingAvailable: boolean;
  /** Distance in miles from patient ZIP, rounded to 1 decimal. Null if unknown. */
  distanceMiles: number | null;
  about: string;
  providerName: string;
  websiteUrl: string;
}

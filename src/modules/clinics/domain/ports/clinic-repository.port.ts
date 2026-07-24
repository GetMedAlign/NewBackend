import type { ClinicReadModel } from '../clinic.entity';
import type {
  ClinicDirectoryFilter,
  ClinicDirectoryQueryResult,
  ClinicProfileReadModel,
} from '../clinic-directory.types';

export interface ClinicRepositoryPort {
  /**
   * Returns all clinics eligible for recommendations:
   *   - status = 'active'
   *   - billing_status NOT IN ('no_card', 'overdue')
   *   - has at least one clinic_categories row matching `category`
   *
   * Includes `categories` and `services` arrays.
   */
  findMatchable(category: string): Promise<ClinicReadModel[]>;

  /** Finds a single clinic by primary-key UUID, or null if not found. */
  findById(id: string): Promise<ClinicReadModel | null>;

  /** Finds a single clinic by URL slug, or null if not found. */
  findBySlug(slug: string): Promise<ClinicReadModel | null>;

  /**
   * Public, paginated clinic directory listing (GET /clinics). Gated the
   * same way as .NET's ClinicsController.GetDirectory:
   *   - status = 'active'
   *   - is_listed_in_directory = true
   *   - billing_status NOT IN ('no_card', 'overdue')
   * plus the optional category/state/telehealth/serviceCode/search filters.
   */
  findDirectory(filter: ClinicDirectoryFilter): Promise<ClinicDirectoryQueryResult>;

  /**
   * Public single-clinic profile by slug (GET /clinics/:slug). Gated like
   * .NET's ClinicsController.GetBySlug — active + billing-current, but NOT
   * `is_listed_in_directory` (a de-listed clinic is still directly reachable
   * by its own slug). Returns null when no such clinic exists.
   */
  findProfileBySlug(slug: string): Promise<ClinicProfileReadModel | null>;
}

export const CLINIC_REPOSITORY = Symbol('ClinicRepositoryPort');

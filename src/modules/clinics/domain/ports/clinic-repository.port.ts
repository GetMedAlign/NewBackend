import type { ClinicReadModel } from '../clinic.entity';

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
}

export const CLINIC_REPOSITORY = Symbol('ClinicRepositoryPort');

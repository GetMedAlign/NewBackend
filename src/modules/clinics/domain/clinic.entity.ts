/**
 * Read model for a clinic — the matchable, serialisable shape consumed by
 * the recommendations (Task 8) and leads (Task 9) modules.
 *
 * Intentionally a plain type (not a class); clinics are read-only reference
 * data with no domain behaviour on the backend.
 *
 * `webhookSecretEncrypted` is the raw AES-GCM ciphertext stored in the DB.
 * It is NOT decrypted here. The leads module decrypts it when signing webhook
 * deliveries, keeping the plaintext out of any read path that doesn't need it.
 */
export type ClinicReadModel = {
  id: string;
  slug: string;
  name: string;
  about: string;
  providerName: string;
  websiteUrl: string;
  city: string | null;
  /** Maps from the DB column `state_code` (Prisma: `stateCode`). */
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  rating: number;
  reviewCount: number;
  telehealthAvailable: boolean;
  newPatientWait: string;
  consultationFeeBand: string;
  monthlyProgramBand: string;
  financingAvailable: boolean;
  acceptsInsurance: boolean;
  status: string;
  billingStatus: string;
  businessEmail: string | null;
  webhookUrl: string | null;
  notifyOnLead: boolean;
  /** Raw AES-GCM ciphertext from `webhook_secret` — NOT decrypted. */
  webhookSecretEncrypted: string | null;
  /** Values from the `clinic_categories` join table. */
  categories: string[];
  /** Service codes from the `clinic_services` join table. */
  services: string[];
};

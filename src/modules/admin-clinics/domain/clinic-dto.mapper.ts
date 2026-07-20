import { formatDateOnly } from '../../../infrastructure/format/date';

export const SPECIALTIES: Readonly<Record<string, string>> = Object.freeze({
  hormone: 'Hormone Therapy',
  peptide: 'Peptide Therapy',
  med_spa: 'Med Spa & Aesthetics',
  wellness: 'Integrative Wellness',
});

export const CLINIC_STATUSES = ['active', 'paused', 'suspended', 'inactive'] as const;
export type ClinicStatusValue = (typeof CLINIC_STATUSES)[number];

export function isClinicStatus(value: string): value is ClinicStatusValue {
  return (CLINIC_STATUSES as readonly string[]).includes(value);
}

export interface ClinicServiceRow {
  service_code: string;
  is_top_service: boolean;
  display_order: number;
}

export interface AdminClinicRow {
  id: string;
  slug: string;
  name: string;
  location: string | null;
  city: string | null;
  state_code: string | null;
  zip_code: string | null;
  rating: number;
  review_count: number;
  about: string | null;
  differentiators: string | null;
  new_patient_wait: string | null;
  telehealth_available: boolean;
  offers_lab_work: boolean;
  website_url: string | null;
  consultation_fee_band: string | null;
  monthly_program_band: string | null;
  financing_available: boolean;
  accepts_insurance: boolean;
  insurance_notes: string | null;
  provider_name: string | null;
  credentials: string | null;
  photo_count: number;
  status: string;
  created_at: Date;
  billing_status: string | null;
  webhook_health: string | null;
  suspension_reason: string | null;
}

export interface AdminClinicDto {
  id: string;
  slug: string;
  name: string;
  category: string;
  specialty: string;
  location: string;
  city: string;
  stateCode: string;
  zipCode: string;
  rating: number;
  reviewCount: number;
  about: string;
  differentiators: string;
  services: string[];
  allServices: string[];
  waitTime: string;
  telehealth: boolean;
  offersLabWork: boolean;
  websiteUrl: string | null;
  consultationFee: string;
  monthlyProgram: string;
  financing: boolean;
  insurance: boolean;
  insuranceNotes: string;
  providerName: string;
  credentials: string;
  photoCount: number;
  status: string;
  createdAt: string;
  leadCount: number;
  lastLeadAt: string | null;
  billingStatus: string | null;
  webhookHealth: string | null;
  suspensionReason: string | null;
}

const orEmpty = (v: string | null): string => v ?? '';

export function toAdminClinicDto(
  row: AdminClinicRow,
  categories: string[],
  services: ClinicServiceRow[],
  leadCount: number,
  lastLeadAt: Date | null,
): AdminClinicDto {
  const category = categories[0] ?? 'wellness';

  const topServices = services
    .filter((s) => s.is_top_service)
    .slice()
    .sort((a, b) => a.display_order - b.display_order)
    .map((s) => s.service_code);

  const allServices = services
    .slice()
    .sort(
      (a, b) =>
        (a.is_top_service ? 0 : 1) - (b.is_top_service ? 0 : 1) ||
        a.display_order - b.display_order,
    )
    .map((s) => s.service_code);

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category,
    specialty: SPECIALTIES[category] ?? category,
    location: orEmpty(row.location),
    city: orEmpty(row.city),
    stateCode: orEmpty(row.state_code),
    zipCode: orEmpty(row.zip_code),
    rating: Number(row.rating),
    reviewCount: row.review_count,
    about: orEmpty(row.about),
    differentiators: orEmpty(row.differentiators),
    services: topServices,
    allServices,
    waitTime: orEmpty(row.new_patient_wait),
    telehealth: row.telehealth_available,
    offersLabWork: row.offers_lab_work,
    websiteUrl: row.website_url,
    consultationFee: orEmpty(row.consultation_fee_band),
    monthlyProgram: orEmpty(row.monthly_program_band),
    financing: row.financing_available,
    insurance: row.accepts_insurance,
    insuranceNotes: orEmpty(row.insurance_notes),
    providerName: orEmpty(row.provider_name),
    credentials: orEmpty(row.credentials),
    photoCount: row.photo_count,
    status: row.status,
    createdAt: formatDateOnly(row.created_at) as string,
    leadCount,
    lastLeadAt: formatDateOnly(lastLeadAt),
    billingStatus: row.billing_status,
    webhookHealth: row.webhook_health,
    suspensionReason: row.suspension_reason,
  };
}

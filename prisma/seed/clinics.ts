/**
 * Seed clinics for the patient-journey slice (~6 clinics spanning all 4
 * assessment categories). Each clinic carries its clinic_categories and
 * clinic_services rows, real lat/long matching a seeded ZIP, rating/review
 * counts, distinct budget/fee bands, and lead-delivery configuration.
 *
 * Coverage guaranteed by this dataset (asserted by the seed integration test):
 *  - >= 1 active + billing-current clinic in EACH category
 *  - one telehealth-only clinic (city/lat/long null) and one in-person-only
 *  - one with financing_available, one with accepts_insurance
 *  - >= 2 clinics with notify_on_lead + business_email + HTTPS webhook_url +
 *    an encrypted webhook_secret
 *  - one billing_status='overdue' and one non-active status (to prove the
 *    matchable filter excludes them)
 */
import type { AssessmentCategory } from '../../generated/prisma/enums';

export type ClinicSeed = {
  slug: string;
  name: string;
  about: string;
  providerName: string;
  websiteUrl: string;
  rating: string;
  reviewCount: number;
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  stateCode: string | null;
  zip: string;
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
  /** Plaintext webhook secret; the seed encrypts it before persisting. */
  webhookSecretPlaintext: string | null;
  notifyOnLead: boolean;
  categories: AssessmentCategory[];
  serviceCodes: string[];
};

export const CLINICS: ReadonlyArray<ClinicSeed> = [
  // 1. Hormone — active, current, notify+webhook, financing, in-person + telehealth
  {
    slug: 'vitality-hormone-nyc',
    name: 'Vitality Hormone Health NYC',
    about: 'Comprehensive hormone optimization and TRT for men and women.',
    providerName: 'Dr. Elena Vance, MD',
    websiteUrl: 'https://vitalityhormone.example.com',
    rating: '4.8',
    reviewCount: 214,
    latitude: 40.7484,
    longitude: -73.9967,
    city: 'New York',
    stateCode: 'NY',
    zip: '10001',
    telehealthAvailable: true,
    newPatientWait: 'same_week',
    consultationFeeBand: '100_200',
    monthlyProgramBand: '200_500',
    financingAvailable: true,
    acceptsInsurance: false,
    status: 'active',
    billingStatus: 'current',
    businessEmail: 'leads@vitalityhormone.example.com',
    webhookUrl: 'https://vitalityhormone.example.com/webhooks/medalign',
    webhookSecretPlaintext: 'whsec_vitality_hormone_nyc_5f3a9c',
    notifyOnLead: true,
    categories: ['hormone', 'wellness'],
    serviceCodes: ['trt', 'thyroid_management', 'hormone_panel'],
  },
  // 2. Peptide — active, current, notify+webhook, telehealth-only (no location)
  {
    slug: 'apex-peptide-telehealth',
    name: 'Apex Peptide Telehealth',
    about: 'Nationwide telehealth peptide therapy and recovery protocols.',
    providerName: 'Dr. Marcus Reid, DO',
    websiteUrl: 'https://apexpeptide.example.com',
    rating: '4.6',
    reviewCount: 98,
    latitude: null,
    longitude: null,
    city: null,
    stateCode: null,
    zip: '94102',
    telehealthAvailable: true,
    newPatientWait: '1_2_weeks',
    consultationFeeBand: '200_500',
    monthlyProgramBand: '500_1k',
    financingAvailable: false,
    acceptsInsurance: false,
    status: 'active',
    billingStatus: 'current',
    businessEmail: 'intake@apexpeptide.example.com',
    webhookUrl: 'https://apexpeptide.example.com/api/leads',
    webhookSecretPlaintext: 'whsec_apex_peptide_9b21ef4',
    notifyOnLead: true,
    categories: ['peptide'],
    serviceCodes: ['bpc157', 'peptide_consult', 'recovery_protocol'],
  },
  // 3. Med spa — active, current, accepts insurance, in-person only (no telehealth)
  {
    slug: 'glow-med-spa-miami',
    name: 'Glow Med Spa Miami',
    about: 'Aesthetic med spa offering injectables, skincare, and body contouring.',
    providerName: 'Dr. Sofia Ramirez, MD',
    websiteUrl: 'https://glowmedspa.example.com',
    rating: '4.9',
    reviewCount: 342,
    latitude: 25.7791,
    longitude: -80.1978,
    city: 'Miami',
    stateCode: 'FL',
    zip: '33101',
    telehealthAvailable: false,
    newPatientWait: '2_4_weeks',
    consultationFeeBand: '100_200',
    monthlyProgramBand: '500_1k',
    financingAvailable: true,
    acceptsInsurance: true,
    status: 'active',
    billingStatus: 'current',
    businessEmail: 'hello@glowmedspa.example.com',
    webhookUrl: null,
    webhookSecretPlaintext: null,
    notifyOnLead: false,
    categories: ['med_spa'],
    serviceCodes: ['botox', 'dermal_fillers', 'body_contouring'],
  },
  // 4. Wellness — active, current, in-person, higher budget band
  {
    slug: 'thrive-wellness-chicago',
    name: 'Thrive Wellness Chicago',
    about: 'Integrative wellness, IV therapy, and longevity programs.',
    providerName: 'Dr. Aaron Kohl, MD',
    websiteUrl: 'https://thrivewellness.example.com',
    rating: '4.5',
    reviewCount: 176,
    latitude: 41.8858,
    longitude: -87.6181,
    city: 'Chicago',
    stateCode: 'IL',
    zip: '60601',
    telehealthAvailable: true,
    newPatientWait: '1_month_plus',
    consultationFeeBand: '500_1k',
    monthlyProgramBand: '1k_plus',
    financingAvailable: false,
    acceptsInsurance: true,
    status: 'active',
    billingStatus: 'current',
    businessEmail: 'care@thrivewellness.example.com',
    webhookUrl: null,
    webhookSecretPlaintext: null,
    notifyOnLead: false,
    categories: ['wellness', 'med_spa'],
    serviceCodes: ['iv_therapy', 'longevity_program', 'nutrition_coaching'],
  },
  // 5. Hormone/wellness — OVERDUE billing (must be excluded by matchable filter)
  {
    slug: 'balance-hormone-la',
    name: 'Balance Hormone LA',
    about: 'Hormone replacement and wellness in Los Angeles.',
    providerName: 'Dr. Priya Nair, MD',
    websiteUrl: 'https://balancehormone.example.com',
    rating: '4.2',
    reviewCount: 61,
    latitude: 33.9731,
    longitude: -118.2479,
    city: 'Los Angeles',
    stateCode: 'CA',
    zip: '90001',
    telehealthAvailable: true,
    newPatientWait: 'same_week',
    consultationFeeBand: '100_200',
    monthlyProgramBand: '200_500',
    financingAvailable: false,
    acceptsInsurance: false,
    status: 'active',
    billingStatus: 'overdue',
    businessEmail: 'billing@balancehormone.example.com',
    webhookUrl: null,
    webhookSecretPlaintext: null,
    notifyOnLead: false,
    categories: ['hormone', 'wellness'],
    serviceCodes: ['trt', 'hormone_panel'],
  },
  // 6. Peptide — NON-ACTIVE status (must be excluded by matchable filter)
  {
    slug: 'renew-peptide-seattle',
    name: 'Renew Peptide Seattle',
    about: 'Peptide therapy clinic currently onboarding.',
    providerName: 'Dr. Grace Lin, DO',
    websiteUrl: 'https://renewpeptide.example.com',
    rating: '4.0',
    reviewCount: 22,
    latitude: 47.6114,
    longitude: -122.3305,
    city: 'Seattle',
    stateCode: 'WA',
    zip: '98101',
    telehealthAvailable: true,
    newPatientWait: '1_2_weeks',
    consultationFeeBand: '200_500',
    monthlyProgramBand: '500_1k',
    financingAvailable: false,
    acceptsInsurance: false,
    status: 'pending',
    billingStatus: 'no_card',
    businessEmail: 'setup@renewpeptide.example.com',
    webhookUrl: null,
    webhookSecretPlaintext: null,
    notifyOnLead: false,
    categories: ['peptide'],
    serviceCodes: ['peptide_consult'],
  },
];

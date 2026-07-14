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
  // Clinic-portal additions (Task 3)
  /** Short text highlighting what sets this clinic apart. */
  differentiators: string | null;
  /** Whether the clinic provides in-house lab work. */
  offersLabWork: boolean;
  /** Notes about insurance coverage, or null. */
  insuranceNotes: string | null;
  /** Provider credentials text, or null. */
  credentials: string | null;
  /** NPI number, or null. */
  npiNumber: string | null;
  /** State license number, or null. */
  stateLicenseNumber: string | null;
  /** Logo URL — null until uploaded. */
  logoUrl: null;
  /** Photo count — always 0 at seed time. */
  photoCount: 0;
  /** Whether to send weekly summary emails to the clinic. */
  weeklySummary: boolean;
  /**
   * Human-readable city/state location string, e.g. "New York, NY".
   * Null for telehealth-only clinics without a physical location.
   */
  location: string | null;
  /** Webhook health status — always 'unknown' at seed time. */
  webhookHealth: 'unknown';
  /** Suspension reason — null at seed time. */
  suspensionReason: null;
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
    // geo-anchor ZIP: 10001
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
    // 'lab_work' is the canonical lab-work service code that scoring component 7 keys on.
    serviceCodes: ['trt', 'thyroid_management', 'hormone_panel', 'lab_work'],
    differentiators: 'Board-certified hormone specialists; same-week appointments; in-house lab.',
    offersLabWork: true,
    insuranceNotes: null,
    credentials: 'MD, Board Certified in Internal Medicine',
    npiNumber: null,
    stateLicenseNumber: null,
    logoUrl: null,
    photoCount: 0,
    weeklySummary: true,
    location: 'New York, NY',
    webhookHealth: 'unknown',
    suspensionReason: null,
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
    // geo-anchor ZIP: 94102 (San Francisco)
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
    // 'lab_work' is the canonical lab-work service code that scoring component 7 keys on.
    serviceCodes: ['bpc157', 'peptide_consult', 'recovery_protocol', 'lab_work'],
    differentiators: 'Nationwide telehealth; cutting-edge peptide protocols; DO-led team.',
    offersLabWork: true,
    insuranceNotes: null,
    credentials: 'DO, Osteopathic Medicine',
    npiNumber: null,
    stateLicenseNumber: null,
    logoUrl: null,
    photoCount: 0,
    weeklySummary: true,
    location: null,
    webhookHealth: 'unknown',
    suspensionReason: null,
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
    // geo-anchor ZIP: 33101
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
    differentiators: 'Top-rated aesthetic med spa; accepts most insurance; 300+ five-star reviews.',
    offersLabWork: false,
    insuranceNotes: 'Accepts PPO and most major carriers; prior authorization may be required.',
    credentials: 'MD, Board Certified in Dermatology',
    npiNumber: null,
    stateLicenseNumber: null,
    logoUrl: null,
    photoCount: 0,
    weeklySummary: false,
    location: 'Miami, FL',
    webhookHealth: 'unknown',
    suspensionReason: null,
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
    // geo-anchor ZIP: 60601
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
    differentiators: 'Integrative MD-led team; custom longevity programs; IV therapy lounge.',
    offersLabWork: false,
    insuranceNotes: 'Accepts some PPO plans for select services; contact for details.',
    credentials: 'MD, Integrative Medicine Fellowship',
    npiNumber: null,
    stateLicenseNumber: null,
    logoUrl: null,
    photoCount: 0,
    weeklySummary: false,
    location: 'Chicago, IL',
    webhookHealth: 'unknown',
    suspensionReason: null,
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
    // geo-anchor ZIP: 90001
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
    differentiators: 'Affordable hormone replacement; same-week availability in LA.',
    offersLabWork: false,
    insuranceNotes: null,
    credentials: 'MD, Board Certified in Endocrinology',
    npiNumber: null,
    stateLicenseNumber: null,
    logoUrl: null,
    photoCount: 0,
    weeklySummary: false,
    location: 'Los Angeles, CA',
    webhookHealth: 'unknown',
    suspensionReason: null,
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
    // geo-anchor ZIP: 98101
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
    differentiators: 'New clinic onboarding; innovative peptide therapy in the Pacific Northwest.',
    offersLabWork: false,
    insuranceNotes: null,
    credentials: 'DO, Osteopathic Medicine',
    npiNumber: null,
    stateLicenseNumber: null,
    logoUrl: null,
    photoCount: 0,
    weeklySummary: false,
    location: 'Seattle, WA',
    webhookHealth: 'unknown',
    suspensionReason: null,
  },
];

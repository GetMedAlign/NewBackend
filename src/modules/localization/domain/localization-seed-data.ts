export interface CitySeed {
  slug: string;
  name: string;
  status: 'available' | 'coming_soon' | 'hidden';
  area: string;
  aliases: string[];
  nearSlugs: string[];
}
export interface ServiceSeed {
  slug: string;
  name: string;
  description: string;
  relatedSlugs: string[];
  codes: string[];
}

export const CITY_SEED: CitySeed[] = [
  {
    slug: 'tampa',
    name: 'Tampa',
    status: 'available',
    area: 'South Tampa, Westshore and Downtown',
    aliases: [],
    nearSlugs: ['st-petersburg', 'bradenton', 'sarasota'],
  },
  {
    slug: 'st-petersburg',
    name: 'St. Petersburg',
    status: 'available',
    area: 'Downtown St. Petersburg and the Old Northeast',
    aliases: ['stpete', 'saintpetersburg', 'stpetersburg', 'saintpete'],
    nearSlugs: ['tampa', 'bradenton', 'sarasota'],
  },
  {
    slug: 'jacksonville',
    name: 'Jacksonville',
    status: 'available',
    area: 'Riverside, San Marco, Southside and the Beaches',
    aliases: ['jax'],
    nearSlugs: ['tampa', 'st-petersburg'],
  },
  {
    slug: 'miami',
    name: 'Miami',
    status: 'available',
    area: 'Brickell, Midtown, Coral Gables and Coconut Grove',
    aliases: [],
    nearSlugs: ['fort-lauderdale', 'naples'],
  },
  {
    slug: 'fort-lauderdale',
    name: 'Fort Lauderdale',
    status: 'available',
    area: 'Las Olas, Victoria Park and Harbor Beach',
    aliases: ['ftlauderdale', 'ftl'],
    nearSlugs: ['miami', 'naples'],
  },
  {
    slug: 'fort-myers',
    name: 'Fort Myers',
    status: 'available',
    area: 'McGregor and South Fort Myers',
    aliases: ['ftmyers'],
    nearSlugs: ['naples', 'sarasota'],
  },
  {
    slug: 'sarasota',
    name: 'Sarasota',
    status: 'available',
    area: 'Downtown Sarasota and Siesta Key',
    aliases: [],
    nearSlugs: ['bradenton', 'st-petersburg', 'fort-myers'],
  },
  {
    slug: 'naples',
    name: 'Naples',
    status: 'coming_soon',
    area: 'Old Naples and Pelican Bay',
    aliases: [],
    nearSlugs: ['fort-myers', 'miami'],
  },
  {
    slug: 'bradenton',
    name: 'Bradenton',
    status: 'available',
    area: 'Downtown Bradenton and the Riverwalk',
    aliases: [],
    nearSlugs: ['sarasota', 'tampa', 'st-petersburg'],
  },
];

export const SERVICE_SEED: ServiceSeed[] = [
  {
    slug: 'hormone-optimization',
    name: 'Hormone Optimization',
    description:
      'Clinics that evaluate and manage hormone levels, typically starting with lab work and continuing with monitoring by a licensed clinician.',
    relatedSlugs: ['sexual-health', 'longevity-anti-aging', 'metabolic-health'],
    codes: ['trt', 'bhrt', 'menopause_hrt'],
  },
  {
    slug: 'peptide-metabolic-therapy',
    name: 'Peptide & Metabolic Therapy',
    description:
      'Clinician supervised programs that use prescribed peptides as part of a broader metabolic or recovery plan.',
    relatedSlugs: ['metabolic-health', 'weight-loss-medicine', 'biohacking-performance'],
    codes: [
      'peptide_anti_aging',
      'peptide_weight_loss',
      'muscle_repair',
      'energy_clarity',
      'muscle_growth',
    ],
  },
  {
    slug: 'med-spa-aesthetics',
    name: 'Med Spa & Aesthetics',
    description:
      'Non-surgical aesthetic treatments such as injectables and skin procedures, performed or supervised by licensed providers.',
    relatedSlugs: ['regenerative-medicine', 'iv-infusion-therapy', 'longevity-anti-aging'],
    codes: [
      'injectables',
      'skin_rejuvenation',
      'laser',
      'body_contouring',
      'facials',
      'microneedling',
      'chemical_peels',
    ],
  },
  {
    slug: 'functional-medicine',
    name: 'Functional Medicine',
    description:
      'An approach that looks at history, lifestyle and lab work together to build an individualized care plan.',
    relatedSlugs: ['metabolic-health', 'longevity-anti-aging', 'hormone-optimization'],
    codes: ['gi_rehab', 'micronutrient_testing'],
  },
  {
    slug: 'metabolic-health',
    name: 'Metabolic Health',
    description:
      'Programs focused on markers like blood sugar, weight and energy, usually combining labs, nutrition and clinical follow up.',
    relatedSlugs: ['weight-loss-medicine', 'peptide-metabolic-therapy', 'functional-medicine'],
    codes: ['weight_management', 'micronutrient_testing', 'energy_clarity'],
  },
  {
    slug: 'iv-infusion-therapy',
    name: 'IV & Infusion Therapy',
    description:
      'Intravenous fluids and nutrients administered in a clinical setting under licensed supervision.',
    relatedSlugs: ['biohacking-performance', 'functional-medicine', 'longevity-anti-aging'],
    codes: ['iv_therapy', 'vitamin_injections'],
  },
  {
    slug: 'weight-loss-medicine',
    name: 'Weight Loss Medicine',
    description:
      'Medically supervised weight management, which may include prescriptions, nutrition support and regular check-ins.',
    relatedSlugs: ['metabolic-health', 'peptide-metabolic-therapy', 'hormone-optimization'],
    codes: ['weight_loss', 'peptide_weight_loss', 'weight_management'],
  },
  {
    slug: 'longevity-anti-aging',
    name: 'Longevity & Anti-Aging',
    description:
      'Preventive programs built around tracking health markers over time and adjusting care based on results.',
    relatedSlugs: ['hormone-optimization', 'biohacking-performance', 'functional-medicine'],
    codes: ['peptide_anti_aging', 'bhrt', 'micronutrient_testing'],
  },
  {
    slug: 'sexual-health',
    name: 'Sexual Health',
    description:
      'Confidential evaluation of sexual health concerns and treatment options with a licensed clinician.',
    relatedSlugs: ['hormone-optimization', 'longevity-anti-aging', 'metabolic-health'],
    codes: ['ed', 'trt', 'menopause_hrt'],
  },
  {
    slug: 'regenerative-medicine',
    name: 'Regenerative Medicine',
    description:
      "Treatments intended to support the body's own repair processes, offered in a clinical setting.",
    relatedSlugs: ['med-spa-aesthetics', 'biohacking-performance', 'iv-infusion-therapy'],
    codes: ['muscle_repair'],
  },
  {
    slug: 'biohacking-performance',
    name: 'Biohacking & Performance',
    description:
      'Performance focused programs combining testing, recovery and lifestyle protocols under clinical guidance.',
    relatedSlugs: ['longevity-anti-aging', 'iv-infusion-therapy', 'peptide-metabolic-therapy'],
    codes: ['energy_clarity', 'muscle_growth', 'muscle_repair'],
  },
];

export function citySeoTitle(name: string): string {
  return `Specialized Clinics in ${name}, FL | MedAlign`;
}
export function citySeoDescription(name: string): string {
  return `Find active, vetted clinics in ${name}, Florida. Compare services and get matched on your goals.`;
}
export function cityIntro(area: string): string {
  return `MedAlign lists active clinics serving ${area}. Compare the services each one offers and take the next step when you are ready.`;
}
export function serviceSeoTitle(name: string): string {
  return `${name} Clinics in Florida | MedAlign`;
}
export function serviceSeoDescription(desc: string): string {
  return desc.length <= 155 ? desc : desc.slice(0, 152) + '...';
}

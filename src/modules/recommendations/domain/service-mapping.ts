/**
 * Goal-to-services and symptom-to-services maps.
 * Ported verbatim from MedAlign-Backend/src/MedAlign.Api/Services/ServiceMapping.cs
 */

const GOAL_TO_SERVICES: ReadonlyMap<string, readonly string[]> = new Map([
  // ── Hormone ───────────────────────────────────────────────────────
  [
    'boost_energy',
    ['trt', 'iv_therapy', 'bhrt', 'vitamin_injections', 'energy_clarity', 'micronutrient_testing'],
  ],
  ['increase_libido', ['trt', 'ed', 'menopause_hrt', 'bhrt']],
  [
    'body_composition',
    ['trt', 'peptide_weight_loss', 'muscle_repair', 'muscle_growth', 'weight_loss'],
  ],
  ['mental_clarity', ['energy_clarity', 'iv_therapy', 'micronutrient_testing', 'trt', 'bhrt']],
  ['mood_balance', ['bhrt', 'menopause_hrt', 'trt', 'iv_therapy', 'acupuncture']],
  ['weight_loss_goal', ['weight_loss', 'peptide_weight_loss', 'weight_management']],
  ['sleep_quality', ['bhrt', 'iv_therapy', 'trt', 'acupuncture', 'menopause_hrt']],
  ['menopause_relief', ['menopause_hrt', 'bhrt', 'trt', 'iv_therapy']],

  // ── Peptide ───────────────────────────────────────────────────────
  ['fat_loss', ['weight_loss', 'peptide_weight_loss', 'weight_management', 'body_contouring']],
  ['muscle_gain', ['muscle_growth', 'muscle_repair', 'trt']],
  ['recovery', ['muscle_repair', 'iv_therapy', 'peptide_anti_aging']],
  [
    'anti_aging',
    ['peptide_anti_aging', 'injectables', 'laser', 'micronutrient_testing', 'skin_rejuvenation'],
  ],
  [
    'immune_boost',
    ['iv_therapy', 'vitamin_injections', 'micronutrient_testing', 'bhrt', 'acupuncture'],
  ],

  // ── Med Spa ───────────────────────────────────────────────────────
  [
    'wrinkle_reduction',
    [
      'injectables',
      'laser',
      'skin_rejuvenation',
      'microneedling',
      'chemical_peels',
      'peptide_anti_aging',
    ],
  ],
  [
    'skin_glow',
    [
      'facials',
      'laser',
      'skin_rejuvenation',
      'chemical_peels',
      'vitamin_injections',
      'microneedling',
    ],
  ],
  ['body_contouring_goal', ['body_contouring', 'weight_management']],
  ['hair_restoration', ['microneedling', 'laser', 'skin_rejuvenation']],
  ['skin_tightening', ['laser', 'skin_rejuvenation', 'microneedling', 'injectables']],
  ['scar_reduction', ['laser', 'microneedling', 'chemical_peels', 'skin_rejuvenation']],

  // ── Wellness ──────────────────────────────────────────────────────
  ['stress_reduction', ['acupuncture', 'massage', 'bhrt', 'iv_therapy']],
  [
    'energy_vitality',
    ['iv_therapy', 'bhrt', 'vitamin_injections', 'energy_clarity', 'micronutrient_testing'],
  ],
  ['gut_health', ['gi_rehab', 'acupuncture', 'iv_therapy']],
  [
    'immune_support',
    ['iv_therapy', 'vitamin_injections', 'acupuncture', 'micronutrient_testing', 'bhrt'],
  ],
  ['hormone_balance', ['bhrt', 'menopause_hrt', 'trt', 'acupuncture']],
  ['detox', ['iv_therapy', 'acupuncture', 'gi_rehab']],
  ['pain_relief', ['acupuncture', 'massage', 'iv_therapy', 'bhrt']],
]);

const SYMPTOM_TO_SERVICES: ReadonlyMap<string, readonly string[]> = new Map([
  // ── Hormone ───────────────────────────────────────────────────────
  [
    'fatigue',
    ['iv_therapy', 'trt', 'bhrt', 'vitamin_injections', 'energy_clarity', 'micronutrient_testing'],
  ],
  ['low_libido', ['trt', 'ed', 'bhrt', 'menopause_hrt']],
  ['weight_gain', ['weight_loss', 'peptide_weight_loss', 'trt', 'weight_management']],
  ['brain_fog', ['energy_clarity', 'iv_therapy', 'micronutrient_testing', 'trt', 'bhrt']],
  ['mood_swings', ['bhrt', 'menopause_hrt', 'trt', 'acupuncture']],
  ['hot_flashes', ['menopause_hrt', 'bhrt', 'trt']],
  ['poor_sleep', ['bhrt', 'trt', 'iv_therapy', 'menopause_hrt', 'acupuncture']],
  ['muscle_loss', ['trt', 'muscle_repair', 'muscle_growth', 'peptide_anti_aging']],

  // ── Peptide ───────────────────────────────────────────────────────
  ['slow_recovery', ['muscle_repair', 'iv_therapy', 'peptide_anti_aging']],
  [
    'low_energy',
    ['energy_clarity', 'iv_therapy', 'vitamin_injections', 'bhrt', 'micronutrient_testing'],
  ],
  [
    'excess_body_fat',
    ['weight_loss', 'peptide_weight_loss', 'body_contouring', 'weight_management'],
  ],
  [
    'aging_signs',
    ['peptide_anti_aging', 'injectables', 'laser', 'skin_rejuvenation', 'micronutrient_testing'],
  ],
  ['low_immunity', ['iv_therapy', 'vitamin_injections', 'acupuncture', 'micronutrient_testing']],

  // ── Med Spa ───────────────────────────────────────────────────────
  ['fine_lines', ['injectables', 'laser', 'microneedling', 'skin_rejuvenation']],
  ['uneven_skin', ['laser', 'chemical_peels', 'skin_rejuvenation', 'microneedling', 'facials']],
  ['sagging_skin', ['laser', 'skin_rejuvenation', 'injectables', 'microneedling']],
  ['dark_spots', ['laser', 'chemical_peels', 'skin_rejuvenation', 'facials']],
  ['stubborn_fat', ['body_contouring', 'weight_management']],
  ['acne_scarring', ['laser', 'microneedling', 'chemical_peels', 'skin_rejuvenation']],

  // ── Wellness ──────────────────────────────────────────────────────
  [
    'chronic_fatigue',
    ['iv_therapy', 'bhrt', 'acupuncture', 'micronutrient_testing', 'energy_clarity'],
  ],
  ['digestive_issues', ['gi_rehab', 'acupuncture']],
  ['chronic_stress', ['acupuncture', 'massage', 'bhrt']],
  ['joint_pain', ['acupuncture', 'massage', 'iv_therapy']],
]);

/**
 * Returns the union of all service codes implied by the given goal codes and
 * symptom codes. Unknown codes contribute nothing. The result is deduplicated.
 */
export function impliedServices(goalCodes: string[], symptomCodes: string[]): Set<string> {
  const services = new Set<string>();
  for (const goal of goalCodes) {
    const mapped = GOAL_TO_SERVICES.get(goal);
    if (mapped) {
      for (const svc of mapped) {
        services.add(svc);
      }
    }
  }
  for (const symptom of symptomCodes) {
    const mapped = SYMPTOM_TO_SERVICES.get(symptom);
    if (mapped) {
      for (const svc of mapped) {
        services.add(svc);
      }
    }
  }
  return services;
}

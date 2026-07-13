import { impliedServices } from './service-mapping';

describe('impliedServices', () => {
  it('returns empty set for empty inputs', () => {
    expect(impliedServices([], [])).toEqual(new Set());
  });

  it('an unknown goal code contributes nothing', () => {
    expect(impliedServices(['unknown_goal'], [])).toEqual(new Set());
  });

  it('an unknown symptom code contributes nothing', () => {
    expect(impliedServices([], ['unknown_symptom'])).toEqual(new Set());
  });

  it('maps boost_energy goal to expected services', () => {
    const result = impliedServices(['boost_energy'], []);
    expect(result.has('trt')).toBe(true);
    expect(result.has('iv_therapy')).toBe(true);
    expect(result.has('bhrt')).toBe(true);
    expect(result.has('vitamin_injections')).toBe(true);
    expect(result.has('energy_clarity')).toBe(true);
    expect(result.has('micronutrient_testing')).toBe(true);
    expect(result.size).toBe(6);
  });

  it('maps wrinkle_reduction goal to expected services', () => {
    const result = impliedServices(['wrinkle_reduction'], []);
    expect(result.has('injectables')).toBe(true);
    expect(result.has('laser')).toBe(true);
    expect(result.has('skin_rejuvenation')).toBe(true);
    expect(result.has('microneedling')).toBe(true);
    expect(result.has('chemical_peels')).toBe(true);
    expect(result.has('peptide_anti_aging')).toBe(true);
    expect(result.size).toBe(6);
  });

  it('maps fatigue symptom to expected services', () => {
    const result = impliedServices([], ['fatigue']);
    expect(result.has('iv_therapy')).toBe(true);
    expect(result.has('trt')).toBe(true);
    expect(result.has('bhrt')).toBe(true);
    expect(result.has('vitamin_injections')).toBe(true);
    expect(result.has('energy_clarity')).toBe(true);
    expect(result.has('micronutrient_testing')).toBe(true);
    expect(result.size).toBe(6);
  });

  it('maps fine_lines symptom to expected services', () => {
    const result = impliedServices([], ['fine_lines']);
    expect(result.has('injectables')).toBe(true);
    expect(result.has('laser')).toBe(true);
    expect(result.has('microneedling')).toBe(true);
    expect(result.has('skin_rejuvenation')).toBe(true);
    expect(result.size).toBe(4);
  });

  it('unions services from multiple goals and symptoms, deduplicated', () => {
    // boost_energy → [trt, iv_therapy, bhrt, vitamin_injections, energy_clarity, micronutrient_testing]
    // weight_loss_goal → [weight_loss, peptide_weight_loss, weight_management]
    // fatigue → [iv_therapy, trt, bhrt, vitamin_injections, energy_clarity, micronutrient_testing]
    // weight_gain → [weight_loss, peptide_weight_loss, trt, weight_management]
    const result = impliedServices(
      ['boost_energy', 'weight_loss_goal'],
      ['fatigue', 'weight_gain'],
    );
    // boost_energy services
    expect(result.has('trt')).toBe(true);
    expect(result.has('iv_therapy')).toBe(true);
    expect(result.has('bhrt')).toBe(true);
    expect(result.has('vitamin_injections')).toBe(true);
    expect(result.has('energy_clarity')).toBe(true);
    expect(result.has('micronutrient_testing')).toBe(true);
    // weight_loss_goal services
    expect(result.has('weight_loss')).toBe(true);
    expect(result.has('peptide_weight_loss')).toBe(true);
    expect(result.has('weight_management')).toBe(true);
    // no duplication — iv_therapy appears in boost_energy and fatigue but counted once
    const expectedSize = new Set([
      'trt',
      'iv_therapy',
      'bhrt',
      'vitamin_injections',
      'energy_clarity',
      'micronutrient_testing',
      'weight_loss',
      'peptide_weight_loss',
      'weight_management',
    ]).size;
    expect(result.size).toBe(expectedSize);
  });

  it('maps gut_health goal to gi_rehab, acupuncture, iv_therapy', () => {
    const result = impliedServices(['gut_health'], []);
    expect(result.has('gi_rehab')).toBe(true);
    expect(result.has('acupuncture')).toBe(true);
    expect(result.has('iv_therapy')).toBe(true);
    expect(result.size).toBe(3);
  });

  it('maps digestive_issues symptom to gi_rehab, acupuncture', () => {
    const result = impliedServices([], ['digestive_issues']);
    expect(result.has('gi_rehab')).toBe(true);
    expect(result.has('acupuncture')).toBe(true);
    expect(result.size).toBe(2);
  });
});

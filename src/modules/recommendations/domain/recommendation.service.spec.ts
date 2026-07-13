/**
 * Unit tests for RecommendationService — scoring algorithm.
 * All point values are exact per spec §5 and .NET RecommendationService.cs.
 * Tests are WRITTEN FIRST (TDD); implementation follows.
 */
import { RecommendationService } from './recommendation.service';
import type { Assessment } from '../../assessments/domain/assessment.entity';
import type { ClinicReadModel } from '../../clinics/domain/clinic.entity';

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Minimal assessment fixture — override individual fields per test. */
function makeAssessment(overrides: Partial<Assessment> = {}): Assessment {
  return {
    id: 'assessment-id-1',
    sessionId: 'session_aabbccdd11223344aabbccdd11223344',
    patientId: null,
    treatmentCategory: 'hormone',
    selectedGoals: [],
    selectedSymptoms: [],
    symptomSeverities: {},
    symptomDuration: null,
    hasPriorTreatment: null,
    exerciseFrequency: null,
    diet: null,
    sleepHours: null,
    stressLevel: null,
    alcoholUse: null,
    willingLabWork: null,
    willingStructuredProgram: null,
    appointmentPreference: null,
    startTimeline: null,
    budgetBand: '200_500',
    telehealthPreference: 'no',
    biologicalSex: null,
    pregnantOrPlanning: null,
    takingPrescriptions: null,
    hadPriorTherapy: null,
    medicationAllergies: null,
    allergyDetails: null,
    chronicConditions: [],
    currentPrescriptions: [],
    otherMedications: null,
    zipCode: '10001',
    submittedAt: new Date(),
    ...overrides,
  };
}

/** Minimal clinic fixture — override individual fields per test. */
function makeClinic(overrides: Partial<ClinicReadModel> = {}): ClinicReadModel {
  return {
    id: 'clinic-id-1',
    slug: 'test-clinic',
    name: 'Test Clinic',
    about: 'About test clinic',
    providerName: 'Dr. Test',
    websiteUrl: 'https://testclinic.example.com',
    city: 'New York',
    state: 'NY',
    latitude: 40.7484,
    longitude: -73.9967,
    rating: 4.0,
    reviewCount: 50,
    telehealthAvailable: false,
    newPatientWait: '',
    consultationFeeBand: '200_500',
    monthlyProgramBand: '200_500',
    financingAvailable: false,
    acceptsInsurance: false,
    status: 'active',
    billingStatus: 'current',
    businessEmail: null,
    webhookUrl: null,
    notifyOnLead: false,
    webhookSecretEncrypted: null,
    categories: ['hormone'],
    services: ['trt', 'bhrt'],
    ...overrides,
  };
}

// ── Service ──────────────────────────────────────────────────────────────────

let svc: RecommendationService;

beforeEach(() => {
  svc = new RecommendationService();
});

// ── 1. Service match ──────────────────────────────────────────────────────────

describe('scoreServiceMatch (component 1, max 40)', () => {
  it('returns 20 when assessment implies no services (neutral)', () => {
    const assessment = makeAssessment({ selectedGoals: [], selectedSymptoms: [] });
    const clinic = makeClinic({ services: ['trt'] });
    // No implied services → neutral 20
    const score = svc.score(assessment, clinic, null);
    // Other components: budget(25) + geo(5) + telehealth(0) + quality(11) + wait(0) + lab(0) + service(20)
    // geo: telehealth=no, null distance → 5; budget: patient=200_500 ci=200_500 → diff=0 → 25
    // quality: rating=4.0, reviews=50 → base=(4/5)*12=9.6→10, confidence=+2 → 12, cap15 → 12
    // So total = 20 + 25 + 5 + 0 + 12 + 0 + 0 = 62
    expect(score).toBe(62);
  });

  it('returns 40 when all implied services are matched', () => {
    // boost_energy → [trt, iv_therapy, bhrt, vitamin_injections, energy_clarity, micronutrient_testing]
    const assessment = makeAssessment({ selectedGoals: ['boost_energy'], selectedSymptoms: [] });
    const clinic = makeClinic({
      services: [
        'trt',
        'iv_therapy',
        'bhrt',
        'vitamin_injections',
        'energy_clarity',
        'micronutrient_testing',
      ],
    });
    const score = svc.score(assessment, clinic, null);
    // service=40 + budget(25) + geo(5) + telehealth(0) + quality(12) + wait(0) + lab(0) = 82
    expect(score).toBe(82);
  });

  it('returns partial match: 2 of 4 implied services matched → 20', () => {
    // fat_loss → [weight_loss, peptide_weight_loss, weight_management, body_contouring] (4 services)
    const assessment = makeAssessment({ selectedGoals: ['fat_loss'], selectedSymptoms: [] });
    const clinic = makeClinic({
      services: ['weight_loss', 'peptide_weight_loss'], // 2 of 4 matched
    });
    const score = svc.score(assessment, clinic, null);
    // service = round(2/4 * 40) = 20
    // budget=25, geo=5, telehealth=0, quality=12, wait=0, lab=0
    // total = 20 + 25 + 5 + 0 + 12 + 0 + 0 = 62
    expect(score).toBe(62);
  });

  it('returns 0 when no implied services are matched', () => {
    const assessment = makeAssessment({ selectedGoals: ['boost_energy'], selectedSymptoms: [] });
    const clinic = makeClinic({
      services: ['body_contouring', 'weight_management'], // no overlap
    });
    const score = svc.score(assessment, clinic, null);
    // service=0, budget=25, geo=5, telehealth=0, quality=12, wait=0, lab=0 = 42
    expect(score).toBe(42);
  });

  it('rounds to nearest int: 1 of 3 implied services → round(13.33) = 13', () => {
    // stress_reduction → [acupuncture, massage, bhrt, iv_therapy] 4 services
    // gut_health → [gi_rehab, acupuncture, iv_therapy] 3 services
    // union = {acupuncture, massage, bhrt, iv_therapy, gi_rehab} = 5 services
    // match 1 of 5 → round(1/5*40) = round(8) = 8
    const assessment = makeAssessment({
      selectedGoals: ['stress_reduction', 'gut_health'],
      selectedSymptoms: [],
    });
    const clinic = makeClinic({ services: ['acupuncture'] }); // 1 of 5
    const score = svc.score(assessment, clinic, null);
    // service=8, budget=25, geo=5, telehealth=0, quality=12, wait=0, lab=0 = 50
    expect(score).toBe(50);
  });
});

// ── 2. Budget ─────────────────────────────────────────────────────────────────

describe('scoreBudget (component 2, max 30)', () => {
  it('returns 15 when patient budget is "unknown"', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: 'unknown',
      telehealthPreference: 'no',
    });
    const clinic = makeClinic({ services: [], monthlyProgramBand: '200_500' });
    const score = svc.score(assessment, clinic, null);
    // budget=15, service=20, geo=5, telehealth=0, quality=12, wait=0, lab=0 = 52
    expect(score).toBe(52);
  });

  it('returns 10 when clinic has no band (empty string)', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '200_500',
      telehealthPreference: 'no',
    });
    const clinic = makeClinic({ services: [], monthlyProgramBand: '' });
    const score = svc.score(assessment, clinic, null);
    // budget=10, service=20, geo=5, telehealth=0, quality=12, wait=0, lab=0 = 47
    expect(score).toBe(47);
  });

  it('returns 25 for exact budget match (index distance 0)', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '500_1k',
      telehealthPreference: 'no',
    });
    const clinic = makeClinic({ services: [], monthlyProgramBand: '500_1k' });
    const score = svc.score(assessment, clinic, null);
    // budget=25, service=20, geo=5, telehealth=0, quality=12, wait=0, lab=0 = 62
    expect(score).toBe(62);
  });

  it('returns 10 for index distance 1', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '100_200',
      telehealthPreference: 'no',
    });
    const clinic = makeClinic({ services: [], monthlyProgramBand: '200_500' });
    const score = svc.score(assessment, clinic, null);
    // budget=10+5 insurance? no. +5 financing? clinic pricier(yes ci>pi) but financing=false → 10
    // service=20, geo=5, telehealth=0, quality=12, wait=0, lab=0 = 47
    expect(score).toBe(47);
  });

  it('returns 0 for index distance 2+', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '100_200',
      telehealthPreference: 'no',
    });
    const clinic = makeClinic({ services: [], monthlyProgramBand: '500_1k' });
    const score = svc.score(assessment, clinic, null);
    // budget=0 (ci-pi=2), service=20, geo=5, telehealth=0, quality=12, wait=0, lab=0 = 37
    expect(score).toBe(37);
  });

  it('+5 if clinic is pricier and has financing (even on base 0)', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '100_200',
      telehealthPreference: 'no',
    });
    const clinic = makeClinic({
      services: [],
      monthlyProgramBand: '1k_plus',
      financingAvailable: true,
    });
    const score = svc.score(assessment, clinic, null);
    // budget: diff=3 → 0 + financing(clinic pricier=yes) +5 = 5
    // service=20, geo=5, telehealth=0, quality=12, wait=0, lab=0 = 42
    expect(score).toBe(42);
  });

  it('+5 if patient is 100_200 and clinic accepts insurance', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '100_200',
      telehealthPreference: 'no',
    });
    const clinic = makeClinic({
      services: [],
      monthlyProgramBand: '100_200',
      acceptsInsurance: true,
    });
    const score = svc.score(assessment, clinic, null);
    // budget: diff=0 → 25 + insurance +5 = 30 (cap 30)
    // service=20, geo=5, telehealth=0, quality=12, wait=0, lab=0 = 67
    expect(score).toBe(67);
  });

  it('caps budget at 30', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '100_200',
      telehealthPreference: 'no',
    });
    const clinic = makeClinic({
      services: [],
      monthlyProgramBand: '200_500',
      financingAvailable: true,
      acceptsInsurance: true,
    });
    const score = svc.score(assessment, clinic, null);
    // budget: diff=1 → 10 + financing(ci>pi) +5 + insurance +5 = 20, cap=30 → 20
    // service=20, geo=5, telehealth=0, quality=12, wait=0, lab=0 = 57
    expect(score).toBe(57);
  });

  it('does NOT add financing bonus when clinic is cheaper (ci <= pi)', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '500_1k',
      telehealthPreference: 'no',
    });
    const clinic = makeClinic({
      services: [],
      monthlyProgramBand: '200_500',
      financingAvailable: true,
    });
    const score = svc.score(assessment, clinic, null);
    // diff=1 → 10; clinic cheaper (ci < pi) → no +5 financing
    // service=20, geo=5, telehealth=0, quality=12, wait=0, lab=0 = 47
    expect(score).toBe(47);
  });
});

// ── 3. Geo ────────────────────────────────────────────────────────────────────

describe('scoreGeo (component 3)', () => {
  const patientGeoNY = { lat: 40.7128, lng: -74.006, state: 'NY' };

  it('telehealth yes → 15 + 10 same state = 25', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '200_500',
      telehealthPreference: 'yes',
    });
    const clinic = makeClinic({ services: [], state: 'NY', telehealthAvailable: false });
    const score = svc.score(assessment, clinic, patientGeoNY);
    // geo=25, telehealth=0 (clinic no telehealth), budget=25, service=20, quality=12, wait=0, lab=0 = 82
    expect(score).toBe(82);
  });

  it('telehealth yes, different state → 15', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '200_500',
      telehealthPreference: 'yes',
    });
    const clinic = makeClinic({ services: [], state: 'TX', telehealthAvailable: false });
    const score = svc.score(assessment, clinic, patientGeoNY);
    // geo=15, telehealth=0, budget=25, service=20, quality=12, wait=0, lab=0 = 72
    expect(score).toBe(72);
  });

  it('telehealth no, <=10 miles → 25', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '200_500',
      telehealthPreference: 'no',
    });
    // Same coordinates = 0 miles distance → <=10 → 25
    const clinic = makeClinic({
      services: [],
      latitude: patientGeoNY.lat,
      longitude: patientGeoNY.lng,
      state: 'NY',
    });
    const score = svc.score(assessment, clinic, patientGeoNY);
    // geo=25, telehealth=0, budget=25, service=20, quality=12, wait=0, lab=0 = 82
    expect(score).toBe(82);
  });

  it('telehealth no, <=25 miles → 15', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '200_500',
      telehealthPreference: 'no',
    });
    // NYC to Newark ~10 miles - we'll use a point ~20 miles away
    const clinic = makeClinic({
      services: [],
      latitude: 40.9176, // ~20 miles north of NYC
      longitude: -74.1719,
      state: 'NJ',
    });
    const score = svc.score(assessment, clinic, patientGeoNY);
    // geo=15 (<=25mi), telehealth=0, budget=25, service=20, quality=12, wait=0, lab=0 = 72
    expect(score).toBe(72);
  });

  it('telehealth no, <=50 miles → 5', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '200_500',
      telehealthPreference: 'no',
    });
    // Philadelphia is ~95 miles from NYC — use a point ~40 miles north
    // Poughkeepsie, NY is ~75 miles from NYC (>50 mi → 0, not <=50)
    // Instead use a point that is definitely 25 < d <= 50 miles from NYC
    // Newark Airport (40.6895, -74.1745) is ~15 miles from NYC
    // Bridgeport CT (41.1792, -73.1894) is ~60+ miles
    // Trenton NJ (40.2171, -74.7429) is ~55 miles
    // Princeton NJ (40.3572, -74.6672) is ~50 miles boundary
    // Use 40.5 lat, -74.3 lng which is ~35 miles south of patientGeoNY
    const clinic = makeClinic({
      services: [],
      latitude: 40.3502,
      longitude: -74.35,
      state: 'NJ',
    });
    const score = svc.score(assessment, clinic, patientGeoNY);
    // geo should be <=50 → 5
    // budget=25, service=20, quality=12, wait=0, lab=0, telehealth=0 = 62
    expect(score).toBe(62); // geo=5
  });

  it('telehealth no, >50 miles → 0', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '200_500',
      telehealthPreference: 'no',
    });
    // Boston MA is ~215 miles from NYC
    const clinic = makeClinic({
      services: [],
      latitude: 42.3601,
      longitude: -71.0589,
      state: 'MA',
    });
    const score = svc.score(assessment, clinic, patientGeoNY);
    // geo=0, budget=25, service=20, quality=12, wait=0, lab=0, telehealth=0 = 57
    expect(score).toBe(57);
  });

  it('telehealth no, null distance (no geo) → 5 (fallback)', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '200_500',
      telehealthPreference: 'no',
    });
    const clinic = makeClinic({ services: [], latitude: null, longitude: null });
    // patientGeo exists but clinic has no coords → null distance → 5
    const score = svc.score(assessment, clinic, patientGeoNY);
    // geo=5, budget=25, service=20, quality=12, wait=0, lab=0, telehealth=0 = 62
    expect(score).toBe(62);
  });

  it('telehealth either → max(in-person, 15+same-state)', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '200_500',
      telehealthPreference: 'either',
    });
    // same state as patient, but very far → in-person=0, telehealth-score=15+10=25 → max=25
    const clinic = makeClinic({ services: [], latitude: 40.0, longitude: -75.0, state: 'NY' });
    const score = svc.score(assessment, clinic, patientGeoNY);
    // distance from patientGeoNY to (40.0, -75.0) should be > 50 miles
    // geo=max(0, 25)=25, telehealth=0 (clinic no telehealth), budget=25, service=20, quality=12, wait=0, lab=0 = 82
    expect(score).toBe(82);
  });

  it('telehealth either → max(in-person=25, tele=15) = 25 when very close', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '200_500',
      telehealthPreference: 'either',
    });
    // same coords = 0 miles → in-person=25; diff state tele=15 → max=25
    const clinic = makeClinic({
      services: [],
      latitude: patientGeoNY.lat,
      longitude: patientGeoNY.lng,
      state: 'CT',
    });
    const score = svc.score(assessment, clinic, patientGeoNY);
    // geo=max(25, 15)=25, telehealth=0, budget=25, service=20, quality=12, wait=0, lab=0 = 82
    expect(score).toBe(82);
  });

  it('telehealth yes, null patientGeo → 15 (state comparison skipped)', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '200_500',
      telehealthPreference: 'yes',
    });
    const clinic = makeClinic({ services: [], state: 'NY' });
    const score = svc.score(assessment, clinic, null);
    // geo: patientGeo=null → patientState=null → 15+0=15
    // budget=25, service=20, quality=12, wait=0, lab=0, telehealth=0 = 72
    expect(score).toBe(72);
  });
});

// ── 4. Telehealth alignment ───────────────────────────────────────────────────

describe('scoreTelehealth (component 4)', () => {
  it('clinic has telehealth + patient yes → 15', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '200_500',
      telehealthPreference: 'yes',
    });
    const clinic = makeClinic({ services: [], telehealthAvailable: true, state: 'TX' });
    const score = svc.score(assessment, clinic, null);
    // geo=15 (yes, diff state), telehealth=15, budget=25, service=20, quality=12, wait=0, lab=0 = 87
    expect(score).toBe(87);
  });

  it('clinic has telehealth + patient either → 5', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '200_500',
      telehealthPreference: 'either',
    });
    const clinic = makeClinic({
      services: [],
      telehealthAvailable: true,
      latitude: null,
      longitude: null,
      state: 'TX',
    });
    const score = svc.score(assessment, clinic, null);
    // geo: either → max(null-distance=5, 15+0=15)=15; telehealth=5; budget=25; service=20; quality=12 = 77
    expect(score).toBe(77);
  });

  it('clinic has telehealth + patient no → 0', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '200_500',
      telehealthPreference: 'no',
    });
    const clinic = makeClinic({
      services: [],
      telehealthAvailable: true,
      latitude: null,
      longitude: null,
    });
    const score = svc.score(assessment, clinic, null);
    // geo=5 (no, null distance), telehealth=0, budget=25, service=20, quality=12, wait=0, lab=0 = 62
    expect(score).toBe(62);
  });

  it('clinic has no telehealth → 0 regardless of patient pref', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '200_500',
      telehealthPreference: 'yes',
    });
    const clinic = makeClinic({ services: [], telehealthAvailable: false, state: 'TX' });
    const score = svc.score(assessment, clinic, null);
    // telehealth=0; geo=15 (yes, diff state); budget=25; service=20; quality=12 = 72
    expect(score).toBe(72);
  });
});

// ── 5. Quality ────────────────────────────────────────────────────────────────

describe('scoreQuality (component 5, max 15)', () => {
  it('0 reviews → fixed 5', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '200_500',
      telehealthPreference: 'no',
    });
    const clinic = makeClinic({
      services: [],
      reviewCount: 0,
      rating: 5.0,
      latitude: null,
      longitude: null,
    });
    const score = svc.score(assessment, clinic, null);
    // quality=5, geo=5, budget=25, service=20, telehealth=0, wait=0, lab=0 = 55
    expect(score).toBe(55);
  });

  it('<10 reviews → base only (0 confidence bump)', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '200_500',
      telehealthPreference: 'no',
    });
    // rating=4.0, reviews=5 → base=round(4/5*12)=round(9.6)=10, bump=0 → 10
    const clinic = makeClinic({
      services: [],
      reviewCount: 5,
      rating: 4.0,
      latitude: null,
      longitude: null,
    });
    const score = svc.score(assessment, clinic, null);
    // quality=10, geo=5, budget=25, service=20, telehealth=0, wait=0, lab=0 = 60
    expect(score).toBe(60);
  });

  it('<50 reviews → +1 confidence bump', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '200_500',
      telehealthPreference: 'no',
    });
    // rating=4.0, reviews=20 → base=10, bump=+1 → 11
    const clinic = makeClinic({
      services: [],
      reviewCount: 20,
      rating: 4.0,
      latitude: null,
      longitude: null,
    });
    const score = svc.score(assessment, clinic, null);
    // quality=11, geo=5, budget=25, service=20, telehealth=0, wait=0, lab=0 = 61
    expect(score).toBe(61);
  });

  it('<200 reviews → +2 confidence bump', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '200_500',
      telehealthPreference: 'no',
    });
    // rating=4.0, reviews=100 → base=10, bump=+2 → 12
    const clinic = makeClinic({
      services: [],
      reviewCount: 100,
      rating: 4.0,
      latitude: null,
      longitude: null,
    });
    const score = svc.score(assessment, clinic, null);
    // quality=12, geo=5, budget=25, service=20, telehealth=0, wait=0, lab=0 = 62
    expect(score).toBe(62);
  });

  it('>=200 reviews → +3 confidence bump', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '200_500',
      telehealthPreference: 'no',
    });
    // rating=4.0, reviews=200 → base=10, bump=+3 → 13
    const clinic = makeClinic({
      services: [],
      reviewCount: 200,
      rating: 4.0,
      latitude: null,
      longitude: null,
    });
    const score = svc.score(assessment, clinic, null);
    // quality=13, geo=5, budget=25, service=20, telehealth=0, wait=0, lab=0 = 63
    expect(score).toBe(63);
  });

  it('caps quality at 15', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '200_500',
      telehealthPreference: 'no',
    });
    // rating=5.0, reviews=200 → base=round(5/5*12)=12, bump=+3 → 15 → cap=15
    const clinic = makeClinic({
      services: [],
      reviewCount: 200,
      rating: 5.0,
      latitude: null,
      longitude: null,
    });
    const score = svc.score(assessment, clinic, null);
    // quality=15, geo=5, budget=25, service=20, telehealth=0, wait=0, lab=0 = 65
    expect(score).toBe(65);
  });

  it('cap prevents exceeding 15 even with high rating + many reviews', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '200_500',
      telehealthPreference: 'no',
    });
    // rating=5.0, reviews=500 → base=12, bump=+3 = 15, capped at 15
    const clinic = makeClinic({
      services: [],
      reviewCount: 500,
      rating: 5.0,
      latitude: null,
      longitude: null,
    });
    const score = svc.score(assessment, clinic, null);
    expect(score).toBe(65);
  });
});

// ── 6. Wait time ──────────────────────────────────────────────────────────────

describe('scoreWaitTime (component 6)', () => {
  const base = makeAssessment({
    selectedGoals: [],
    budgetBand: '200_500',
    telehealthPreference: 'no',
  });

  it('just_researching → 0', () => {
    const assessment = makeAssessment({ ...base, startTimeline: 'just_researching' });
    const clinic = makeClinic({
      services: [],
      newPatientWait: 'same_week',
      latitude: null,
      longitude: null,
    });
    const score = svc.score(assessment, clinic, null);
    // wait=0, geo=5, budget=25, service=20, quality=12, telehealth=0, lab=0 = 62
    expect(score).toBe(62);
  });

  it('empty/null startTimeline → 0', () => {
    const assessment = makeAssessment({ ...base, startTimeline: null });
    const clinic = makeClinic({
      services: [],
      newPatientWait: 'same_week',
      latitude: null,
      longitude: null,
    });
    const score = svc.score(assessment, clinic, null);
    // wait=0
    expect(score).toBe(62);
  });

  it('clinic empty wait → 0', () => {
    const assessment = makeAssessment({ ...base, startTimeline: 'asap' });
    const clinic = makeClinic({
      services: [],
      newPatientWait: '',
      latitude: null,
      longitude: null,
    });
    const score = svc.score(assessment, clinic, null);
    // wait=0
    expect(score).toBe(62);
  });

  it('asap + same_week (index 0) → 8', () => {
    const assessment = makeAssessment({ ...base, startTimeline: 'asap' });
    const clinic = makeClinic({
      services: [],
      newPatientWait: 'same_week',
      latitude: null,
      longitude: null,
    });
    const score = svc.score(assessment, clinic, null);
    // wait=8, geo=5, budget=25, service=20, quality=12, telehealth=0, lab=0 = 70
    expect(score).toBe(70);
  });

  it('asap + 1_2_weeks (index 1) → 3', () => {
    const assessment = makeAssessment({ ...base, startTimeline: 'asap' });
    const clinic = makeClinic({
      services: [],
      newPatientWait: '1_2_weeks',
      latitude: null,
      longitude: null,
    });
    const score = svc.score(assessment, clinic, null);
    // wait=3
    expect(score).toBe(65);
  });

  it('asap + 2_4_weeks (index 2) → 0', () => {
    const assessment = makeAssessment({ ...base, startTimeline: 'asap' });
    const clinic = makeClinic({
      services: [],
      newPatientWait: '2_4_weeks',
      latitude: null,
      longitude: null,
    });
    const score = svc.score(assessment, clinic, null);
    // wait=0
    expect(score).toBe(62);
  });

  it('asap + 1_month_plus (index 3) → -5', () => {
    const assessment = makeAssessment({ ...base, startTimeline: 'asap' });
    const clinic = makeClinic({
      services: [],
      newPatientWait: '1_month_plus',
      latitude: null,
      longitude: null,
    });
    const score = svc.score(assessment, clinic, null);
    // wait=-5
    expect(score).toBe(57);
  });

  it('within_month + same_week (index 0) → 5', () => {
    const assessment = makeAssessment({ ...base, startTimeline: 'within_month' });
    const clinic = makeClinic({
      services: [],
      newPatientWait: 'same_week',
      latitude: null,
      longitude: null,
    });
    const score = svc.score(assessment, clinic, null);
    // wait=5
    expect(score).toBe(67);
  });

  it('within_month + 1_2_weeks (index 1) → 8', () => {
    const assessment = makeAssessment({ ...base, startTimeline: 'within_month' });
    const clinic = makeClinic({
      services: [],
      newPatientWait: '1_2_weeks',
      latitude: null,
      longitude: null,
    });
    const score = svc.score(assessment, clinic, null);
    // wait=8
    expect(score).toBe(70);
  });

  it('within_month + 2_4_weeks (index 2) → 5', () => {
    const assessment = makeAssessment({ ...base, startTimeline: 'within_month' });
    const clinic = makeClinic({
      services: [],
      newPatientWait: '2_4_weeks',
      latitude: null,
      longitude: null,
    });
    const score = svc.score(assessment, clinic, null);
    // wait=5
    expect(score).toBe(67);
  });

  it('within_month + 1_month_plus (index 3) → 0', () => {
    const assessment = makeAssessment({ ...base, startTimeline: 'within_month' });
    const clinic = makeClinic({
      services: [],
      newPatientWait: '1_month_plus',
      latitude: null,
      longitude: null,
    });
    const score = svc.score(assessment, clinic, null);
    // wait=0
    expect(score).toBe(62);
  });

  it('few_months → always 2 regardless of clinic wait', () => {
    const assessment = makeAssessment({ ...base, startTimeline: 'few_months' });
    for (const wait of ['same_week', '1_2_weeks', '2_4_weeks', '1_month_plus']) {
      const clinic = makeClinic({
        services: [],
        newPatientWait: wait,
        latitude: null,
        longitude: null,
      });
      const score = svc.score(assessment, clinic, null);
      // wait=2
      expect(score).toBe(64);
    }
  });
});

// ── 7. Lab work ───────────────────────────────────────────────────────────────

describe('scoreLabWork (component 7)', () => {
  it('patient willing + clinic offers lab → 5', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '200_500',
      telehealthPreference: 'no',
      willingLabWork: true,
    });
    const clinic = makeClinic({ services: ['lab_work'], latitude: null, longitude: null });
    const score = svc.score(assessment, clinic, null);
    // lab=5, service=round(1/implied? — wait, no implied goals, so service=20)
    // Actually: no goals/symptoms → implied=empty → service=20
    // lab=5, geo=5, budget=25, service=20, quality=12, wait=0, telehealth=0 = 67
    expect(score).toBe(67);
  });

  it('patient NOT willing + clinic offers lab → 0', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '200_500',
      telehealthPreference: 'no',
      willingLabWork: false,
    });
    const clinic = makeClinic({ services: ['lab_work'], latitude: null, longitude: null });
    const score = svc.score(assessment, clinic, null);
    // lab=0
    expect(score).toBe(62);
  });

  it('patient willing=null + clinic offers lab → 0', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '200_500',
      telehealthPreference: 'no',
      willingLabWork: null,
    });
    const clinic = makeClinic({ services: ['lab_work'], latitude: null, longitude: null });
    const score = svc.score(assessment, clinic, null);
    // lab=0
    expect(score).toBe(62);
  });

  it('patient willing but clinic does NOT offer lab → 0', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '200_500',
      telehealthPreference: 'no',
      willingLabWork: true,
    });
    const clinic = makeClinic({ services: ['trt'], latitude: null, longitude: null });
    // implied services for empty goals = empty, so service=20 but trt is the service
    // Actually: no goals/symptoms → implied=empty set → 20 neutral
    // lab=0
    const score = svc.score(assessment, clinic, null);
    expect(score).toBe(62);
  });
});

// ── Tie-break and ranking ─────────────────────────────────────────────────────

describe('rank — tie-break and top-10', () => {
  it('equal score: higher rating first, then lower id (asc) for determinism', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '200_500',
      telehealthPreference: 'no',
    });

    // Two clinics with identical scoring inputs; differ only by id and rating.
    const clinicA = makeClinic({
      id: 'aaaaaaaa-0000-0000-0000-000000000001',
      rating: 4.5,
      reviewCount: 50,
      latitude: null,
      longitude: null,
      monthlyProgramBand: '200_500',
      services: [],
    });
    const clinicB = makeClinic({
      id: 'bbbbbbbb-0000-0000-0000-000000000002',
      rating: 4.0,
      reviewCount: 50,
      latitude: null,
      longitude: null,
      monthlyProgramBand: '200_500',
      services: [],
    });

    const results = svc.rank(assessment, [clinicB, clinicA], null);
    // A has higher rating → comes first
    expect(results[0].clinicId).toBe('aaaaaaaa-0000-0000-0000-000000000001');
    expect(results[1].clinicId).toBe('bbbbbbbb-0000-0000-0000-000000000002');
  });

  it('equal score AND equal rating: lower id (lexicographic asc) comes first', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '200_500',
      telehealthPreference: 'no',
    });

    const clinicA = makeClinic({
      id: 'aaaaaaaa-0000-0000-0000-000000000001',
      rating: 4.0,
      reviewCount: 50,
      latitude: null,
      longitude: null,
      monthlyProgramBand: '200_500',
      services: [],
    });
    const clinicB = makeClinic({
      id: 'bbbbbbbb-0000-0000-0000-000000000002',
      rating: 4.0,
      reviewCount: 50,
      latitude: null,
      longitude: null,
      monthlyProgramBand: '200_500',
      services: [],
    });

    const results = svc.rank(assessment, [clinicB, clinicA], null);
    expect(results[0].clinicId).toBe('aaaaaaaa-0000-0000-0000-000000000001');
    expect(results[1].clinicId).toBe('bbbbbbbb-0000-0000-0000-000000000002');
  });

  it('rank returns at most 10 results', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '200_500',
      telehealthPreference: 'no',
    });
    const clinics = Array.from({ length: 15 }, (_, i) =>
      makeClinic({
        id: `clinic-id-${String(i).padStart(2, '0')}`,
        latitude: null,
        longitude: null,
        services: [],
      }),
    );
    const results = svc.rank(assessment, clinics, null);
    expect(results.length).toBeLessThanOrEqual(10);
  });

  it('rank sorts by score descending', () => {
    // clinic with no services + rating 4.0/50 reviews vs clinic with all services + same
    const lowClinic = makeClinic({
      id: 'low-clinic-id',
      services: [],
      latitude: null,
      longitude: null,
      rating: 4.0,
      reviewCount: 50,
    });
    // Higher scoring: asap wait + same_week clinic
    const highClinic = makeClinic({
      id: 'high-clinic-id',
      services: [],
      newPatientWait: 'same_week',
      latitude: null,
      longitude: null,
      rating: 4.0,
      reviewCount: 50,
    });
    const highAssessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '200_500',
      telehealthPreference: 'no',
      startTimeline: 'asap',
    });
    const results = svc.rank(highAssessment, [lowClinic, highClinic], null);
    expect(results[0].clinicId).toBe('high-clinic-id');
    expect(results[1].clinicId).toBe('low-clinic-id');
  });

  it('ClinicMatchDto maps all required fields', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '200_500',
      telehealthPreference: 'no',
    });
    const clinic = makeClinic({
      id: 'clinic-uuid-1',
      slug: 'test-slug',
      name: 'Test Clinic Name',
      city: 'Chicago',
      state: 'IL',
      rating: 4.5,
      reviewCount: 100,
      services: ['trt', 'bhrt'],
      categories: ['hormone'],
      telehealthAvailable: true,
      newPatientWait: '1_2_weeks',
      consultationFeeBand: '200_500',
      monthlyProgramBand: '200_500',
      financingAvailable: true,
      latitude: null,
      longitude: null,
      about: 'Test about text',
      providerName: 'Dr. Provider',
      websiteUrl: 'https://test.example.com',
    });
    const results = svc.rank(assessment, [clinic], null);
    expect(results).toHaveLength(1);
    const dto = results[0];
    expect(dto.clinicId).toBe('clinic-uuid-1');
    expect(dto.slug).toBe('test-slug');
    expect(dto.name).toBe('Test Clinic Name');
    expect(typeof dto.score).toBe('number');
    expect(dto.location).toBe('Chicago, IL');
    expect(dto.rating).toBe(4.5);
    expect(dto.reviewCount).toBe(100);
    expect(Array.isArray(dto.topServices)).toBe(true);
    expect(dto.categories).toEqual(['hormone']);
    expect(dto.telehealthAvailable).toBe(true);
    expect(dto.newPatientWait).toBe('1_2_weeks');
    expect(dto.consultationFeeBand).toBe('200_500');
    expect(dto.monthlyProgramBand).toBe('200_500');
    expect(dto.financingAvailable).toBe(true);
    expect(dto.distanceMiles).toBeNull();
    expect(dto.about).toBe('Test about text');
    expect(dto.providerName).toBe('Dr. Provider');
    expect(dto.websiteUrl).toBe('https://test.example.com');
  });

  it('distanceMiles is rounded to 1 decimal when available', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '200_500',
      telehealthPreference: 'no',
    });
    const patientGeo = { lat: 40.7128, lng: -74.006, state: 'NY' };
    const clinic = makeClinic({
      id: 'clinic-dist-1',
      // ~17 miles from NYC
      latitude: 40.9176,
      longitude: -74.1719,
      state: 'NJ',
      services: [],
    });
    const results = svc.rank(assessment, [clinic], patientGeo);
    expect(results[0].distanceMiles).not.toBeNull();
    const d = results[0].distanceMiles as number;
    // Should be a number with at most 1 decimal place
    expect(d).toBe(Math.round(d * 10) / 10);
  });

  it('location is "City, State" format', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '200_500',
      telehealthPreference: 'no',
    });
    const clinic = makeClinic({
      city: 'Miami',
      state: 'FL',
      services: [],
      latitude: null,
      longitude: null,
    });
    const results = svc.rank(assessment, [clinic], null);
    expect(results[0].location).toBe('Miami, FL');
  });

  it('location handles null city/state gracefully', () => {
    const assessment = makeAssessment({
      selectedGoals: [],
      budgetBand: '200_500',
      telehealthPreference: 'no',
    });
    const clinic = makeClinic({
      city: null,
      state: null,
      services: [],
      latitude: null,
      longitude: null,
    });
    const results = svc.rank(assessment, [clinic], null);
    expect(typeof results[0].location).toBe('string');
  });
});

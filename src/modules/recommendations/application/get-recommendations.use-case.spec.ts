/**
 * Unit tests for GetRecommendationsUseCase.
 * Written FIRST (TDD).
 */
import { GetRecommendationsUseCase } from './get-recommendations.use-case';
import { RecommendationService } from '../domain/recommendation.service';
import { RecommendationNotFoundError } from '../domain/errors/recommendation-not-found.error';
import type { AssessmentRepositoryPort } from '../../assessments/domain/ports/assessment-repository.port';
import type { ClinicRepositoryPort } from '../../clinics/domain/ports/clinic-repository.port';
import type { ZipGeocoder } from '../../../infrastructure/geo/zip-geocoder';
import type { Assessment } from '../../assessments/domain/assessment.entity';
import type { ClinicReadModel } from '../../clinics/domain/clinic.entity';

// ── Minimal fixtures ─────────────────────────────────────────────────────────

const VALID_SESSION_ID = 'session_aabbccdd11223344aabbccdd11223344';
const INVALID_SESSION_ID = 'bad-session';

function makeAssessment(overrides: Partial<Assessment> = {}): Assessment {
  return {
    id: 'assessment-id-1',
    sessionId: VALID_SESSION_ID,
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

function makeClinic(overrides: Partial<ClinicReadModel> = {}): ClinicReadModel {
  return {
    id: 'clinic-id-1',
    slug: 'test-clinic',
    name: 'Test Clinic',
    about: 'About',
    providerName: 'Dr. Test',
    websiteUrl: 'https://test.example.com',
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
    services: ['trt'],
    ...overrides,
  };
}

// ── Mocks ────────────────────────────────────────────────────────────────────

function makeAssessmentRepo(assessment: Assessment | null): AssessmentRepositoryPort {
  return {
    findBySessionId: jest.fn().mockResolvedValue(assessment),
    create: jest.fn(),
    findLatestByPatientUser: jest.fn(),
    linkToPatient: jest.fn(),
  };
}

function makeClinicRepo(clinics: ClinicReadModel[]): ClinicRepositoryPort {
  return {
    findMatchable: jest.fn().mockResolvedValue(clinics),
    findById: jest.fn(),
    findBySlug: jest.fn(),
  };
}

function makeZipGeocoder(result: { lat: number; lng: number; state: string } | null): ZipGeocoder {
  return {
    lookup: jest.fn().mockResolvedValue(result),
  } as unknown as ZipGeocoder;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('GetRecommendationsUseCase', () => {
  const recommendationService = new RecommendationService();

  it('rejects an invalid sessionId format with RecommendationNotFoundError', async () => {
    const uc = new GetRecommendationsUseCase(
      recommendationService,
      makeAssessmentRepo(null),
      makeClinicRepo([]),
      makeZipGeocoder(null),
    );
    await expect(uc.execute(INVALID_SESSION_ID)).rejects.toThrow(RecommendationNotFoundError);
  });

  it('rejects sessionId with wrong prefix with RecommendationNotFoundError', async () => {
    const uc = new GetRecommendationsUseCase(
      recommendationService,
      makeAssessmentRepo(null),
      makeClinicRepo([]),
      makeZipGeocoder(null),
    );
    await expect(uc.execute('token_aabbccdd11223344aabbccdd11223344')).rejects.toThrow(
      RecommendationNotFoundError,
    );
  });

  it('rejects when assessment is not found with RecommendationNotFoundError', async () => {
    const uc = new GetRecommendationsUseCase(
      recommendationService,
      makeAssessmentRepo(null),
      makeClinicRepo([]),
      makeZipGeocoder(null),
    );
    await expect(uc.execute(VALID_SESSION_ID)).rejects.toThrow(RecommendationNotFoundError);
  });

  it('calls findMatchable with the assessment treatment category', async () => {
    const assessment = makeAssessment({ treatmentCategory: 'hormone' });
    const clinicRepo = makeClinicRepo([makeClinic()]);
    const uc = new GetRecommendationsUseCase(
      recommendationService,
      makeAssessmentRepo(assessment),
      clinicRepo,
      makeZipGeocoder(null),
    );
    await uc.execute(VALID_SESSION_ID);
    expect(clinicRepo.findMatchable).toHaveBeenCalledWith('hormone');
  });

  it('calls ZipGeocoder.lookup with assessment zipCode', async () => {
    const assessment = makeAssessment({ zipCode: '10001' });
    const geocoder = makeZipGeocoder(null);
    const uc = new GetRecommendationsUseCase(
      recommendationService,
      makeAssessmentRepo(assessment),
      makeClinicRepo([]),
      geocoder,
    );
    await uc.execute(VALID_SESSION_ID);
    expect(geocoder.lookup).toHaveBeenCalledWith('10001');
  });

  it('returns ranked ClinicMatchDtos when everything succeeds', async () => {
    const assessment = makeAssessment();
    const clinic = makeClinic();
    const geo = { lat: 40.7128, lng: -74.006, state: 'NY' };
    const uc = new GetRecommendationsUseCase(
      recommendationService,
      makeAssessmentRepo(assessment),
      makeClinicRepo([clinic]),
      makeZipGeocoder(geo),
    );
    const results = await uc.execute(VALID_SESSION_ID);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(1);
    expect(results[0].clinicId).toBe('clinic-id-1');
    expect(typeof results[0].score).toBe('number');
  });

  it('returns empty array when no clinics match', async () => {
    const uc = new GetRecommendationsUseCase(
      recommendationService,
      makeAssessmentRepo(makeAssessment()),
      makeClinicRepo([]),
      makeZipGeocoder(null),
    );
    const results = await uc.execute(VALID_SESSION_ID);
    expect(results).toEqual([]);
  });

  it('passes null patientGeo to rank when ZIP lookup fails', async () => {
    const rankSpy = jest.spyOn(recommendationService, 'rank');
    const assessment = makeAssessment();
    const uc = new GetRecommendationsUseCase(
      recommendationService,
      makeAssessmentRepo(assessment),
      makeClinicRepo([makeClinic()]),
      makeZipGeocoder(null), // lookup returns null
    );
    await uc.execute(VALID_SESSION_ID);
    expect(rankSpy).toHaveBeenCalledWith(assessment, expect.any(Array), null);
    rankSpy.mockRestore();
  });
});

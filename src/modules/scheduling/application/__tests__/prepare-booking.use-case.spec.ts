import { PrepareBookingUseCase } from '../prepare-booking.use-case';
import type { ClinicRepositoryPort } from '../../../clinics/domain/ports/clinic-repository.port';
import type { ClinicReadModel } from '../../../clinics/domain/clinic.entity';
import { ClinicNotFoundError } from '../../../clinics/domain/errors/clinic-not-found.error';
import type { PatientRepositoryPort, PatientProfile } from '../../../patients/domain/ports/patient-repository.port';
import type { LeadRepositoryPort } from '../../../leads/domain/ports/lead-repository.port';
import type { EncryptionPort } from '../../../auth/domain/ports/encryption.port';
import type { SubmitLeadUseCase } from '../../../leads/application/submit-lead.use-case';
import type { GetLatestAssessmentUseCase } from '../../../assessments/application/get-latest-assessment.use-case';
import type { Assessment } from '../../../assessments/domain/assessment.entity';

const USER_ID = 'user_1';
const SLUG = 'acme-clinic';
const CLINIC_ID = 'clinic-123';
const PATIENT_EMAIL = 'jane@example.com';
const PATIENT_NAME = 'Jane Doe';

function makeClinic(overrides: Partial<ClinicReadModel> = {}): ClinicReadModel {
  return {
    id: CLINIC_ID,
    slug: SLUG,
    name: 'Acme Clinic',
    about: '',
    providerName: '',
    websiteUrl: '',
    city: null,
    state: null,
    latitude: null,
    longitude: null,
    rating: 0,
    reviewCount: 0,
    telehealthAvailable: false,
    newPatientWait: '',
    consultationFeeBand: '',
    monthlyProgramBand: '',
    financingAvailable: false,
    acceptsInsurance: false,
    status: 'active',
    billingStatus: 'current',
    businessEmail: null,
    webhookUrl: null,
    notifyOnLead: false,
    webhookSecretEncrypted: null,
    categories: [],
    services: [],
    schedulingProvider: 'calendly',
    calendlySchedulingUrl: 'https://calendly.com/acme/consult',
    ...overrides,
  };
}

function makeProfile(overrides: Partial<PatientProfile> = {}): PatientProfile {
  return {
    name: PATIENT_NAME,
    email: PATIENT_EMAIL,
    dob: null,
    zipCode: null,
    isDeleted: false,
    hasPatient: true,
    ...overrides,
  };
}

function makeAssessment(overrides: Partial<Assessment> = {}): Assessment {
  return {
    id: 'assessment-1',
    sessionId: 'session-1',
    patientId: null,
    treatmentCategory: 'hormone',
    selectedGoals: ['energy'],
    selectedSymptoms: ['fatigue'],
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
    appointmentPreference: 'telehealth',
    startTimeline: 'asap',
    budgetBand: 'mid',
    telehealthPreference: 'yes',
    biologicalSex: null,
    pregnantOrPlanning: null,
    takingPrescriptions: null,
    hadPriorTherapy: null,
    medicationAllergies: null,
    allergyDetails: null,
    chronicConditions: [],
    currentPrescriptions: [],
    otherMedications: null,
    zipCode: '94105',
    submittedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeEncryption(): jest.Mocked<EncryptionPort> {
  return {
    encrypt: jest.fn((plaintext: string) => `enc(${plaintext})`),
    decrypt: jest.fn(),
  } as unknown as jest.Mocked<EncryptionPort>;
}

describe('PrepareBookingUseCase', () => {
  let clinics: jest.Mocked<Pick<ClinicRepositoryPort, 'findBySlug'>>;
  let patients: jest.Mocked<Pick<PatientRepositoryPort, 'findProfile'>>;
  let leads: jest.Mocked<Pick<LeadRepositoryPort, 'findLatestByClinicAndEmail'>>;
  let encryption: jest.Mocked<EncryptionPort>;
  let submitLead: jest.Mocked<Pick<SubmitLeadUseCase, 'execute'>>;
  let getLatestAssessment: jest.Mocked<Pick<GetLatestAssessmentUseCase, 'execute'>>;
  let useCase: PrepareBookingUseCase;

  beforeEach(() => {
    clinics = { findBySlug: jest.fn() };
    patients = { findProfile: jest.fn() };
    leads = { findLatestByClinicAndEmail: jest.fn() };
    encryption = makeEncryption();
    submitLead = { execute: jest.fn() };
    getLatestAssessment = { execute: jest.fn() };

    useCase = new PrepareBookingUseCase(
      clinics as unknown as ClinicRepositoryPort,
      patients as unknown as PatientRepositoryPort,
      leads as unknown as LeadRepositoryPort,
      encryption,
      submitLead as unknown as SubmitLeadUseCase,
      getLatestAssessment as unknown as GetLatestAssessmentUseCase,
    );
  });

  it('throws ClinicNotFoundError when no clinic matches the slug', async () => {
    clinics.findBySlug.mockResolvedValue(null);

    await expect(useCase.execute({ userId: USER_ID, slug: SLUG })).rejects.toBeInstanceOf(
      ClinicNotFoundError,
    );
  });

  it('returns provider "request" with no tracking data when the clinic has not connected Calendly', async () => {
    clinics.findBySlug.mockResolvedValue(makeClinic({ schedulingProvider: 'none', calendlySchedulingUrl: null }));

    const result = await useCase.execute({ userId: USER_ID, slug: SLUG });

    expect(result).toEqual({
      provider: 'request',
      schedulingUrl: null,
      trackingToken: null,
      inviteeName: null,
      inviteeEmail: null,
    });
    expect(patients.findProfile).not.toHaveBeenCalled();
  });

  it('returns provider "request" when schedulingProvider is calendly but no scheduling URL is set', async () => {
    clinics.findBySlug.mockResolvedValue(makeClinic({ calendlySchedulingUrl: null }));

    const result = await useCase.execute({ userId: USER_ID, slug: SLUG });

    expect(result.provider).toBe('request');
  });

  it('mints a tracking token from the existing lead when connected and a lead already exists', async () => {
    clinics.findBySlug.mockResolvedValue(makeClinic());
    patients.findProfile.mockResolvedValue(makeProfile());
    leads.findLatestByClinicAndEmail.mockResolvedValue({ leadId: 'lead-existing' });

    const result = await useCase.execute({ userId: USER_ID, slug: SLUG });

    expect(leads.findLatestByClinicAndEmail).toHaveBeenCalledWith(CLINIC_ID, PATIENT_EMAIL);
    expect(submitLead.execute).not.toHaveBeenCalled();
    expect(encryption.encrypt).toHaveBeenCalledWith(`lead-existing:${CLINIC_ID}`);
    expect(result).toEqual({
      provider: 'calendly',
      schedulingUrl: 'https://calendly.com/acme/consult',
      trackingToken: `enc(lead-existing:${CLINIC_ID})`,
      inviteeName: PATIENT_NAME,
      inviteeEmail: PATIENT_EMAIL,
    });
  });

  it('creates a lead from the latest assessment when connected, no lead exists, and an assessment exists', async () => {
    clinics.findBySlug.mockResolvedValue(makeClinic());
    patients.findProfile.mockResolvedValue(makeProfile());
    leads.findLatestByClinicAndEmail.mockResolvedValue(null);
    const assessment = makeAssessment();
    getLatestAssessment.execute.mockResolvedValue(assessment);
    submitLead.execute.mockResolvedValue({ leadId: 'lead-new' });

    const result = await useCase.execute({ userId: USER_ID, slug: SLUG });

    expect(getLatestAssessment.execute).toHaveBeenCalledWith({ userId: USER_ID });
    expect(submitLead.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: CLINIC_ID,
        patientEmail: PATIENT_EMAIL,
        treatmentCategory: assessment.treatmentCategory,
        patientZip: assessment.zipCode,
        topGoals: assessment.selectedGoals,
        topSymptoms: assessment.selectedSymptoms,
        budgetBand: assessment.budgetBand,
        telehealthPreference: assessment.telehealthPreference,
        appointmentPreference: assessment.appointmentPreference,
        startTimeline: assessment.startTimeline,
      }),
      { userId: USER_ID, name: PATIENT_NAME },
    );
    expect(encryption.encrypt).toHaveBeenCalledWith(`lead-new:${CLINIC_ID}`);
    expect(result.trackingToken).toBe(`enc(lead-new:${CLINIC_ID})`);
    expect(result.provider).toBe('calendly');
  });

  it('returns provider "calendly" with a null token when connected, no lead, and no assessment exists', async () => {
    clinics.findBySlug.mockResolvedValue(makeClinic());
    patients.findProfile.mockResolvedValue(makeProfile());
    leads.findLatestByClinicAndEmail.mockResolvedValue(null);
    getLatestAssessment.execute.mockResolvedValue(null);

    const result = await useCase.execute({ userId: USER_ID, slug: SLUG });

    expect(submitLead.execute).not.toHaveBeenCalled();
    expect(encryption.encrypt).not.toHaveBeenCalled();
    expect(result).toEqual({
      provider: 'calendly',
      schedulingUrl: 'https://calendly.com/acme/consult',
      trackingToken: null,
      inviteeName: PATIENT_NAME,
      inviteeEmail: PATIENT_EMAIL,
    });
  });
});

import { SubmitLeadUseCase } from './submit-lead.use-case';
import type { SubmitLeadInput } from './submit-lead.use-case';
import { ClinicNotFoundError } from '../domain/errors/clinic-not-found.error';
import type { ClinicRepositoryPort } from '../../clinics/domain/ports/clinic-repository.port';
import type { ClinicReadModel } from '../../clinics/domain/clinic.entity';
import type { AssessmentRepositoryPort } from '../../assessments/domain/ports/assessment-repository.port';
import type { Assessment } from '../../assessments/domain/assessment.entity';
import type { LeadRepositoryPort } from '../domain/ports/lead-repository.port';
import type { WebhookSenderPort } from '../domain/ports/webhook-sender.port';
import type { EmailSenderPort } from '../../auth/infrastructure/adapters/email-sender.port';
import type { EncryptionPort } from '../../auth/domain/ports/encryption.port';
import type { PatientRepositoryPort } from '../../patients/domain/ports/patient-repository.port';
import { ClaimTokenService } from '../../assessments/domain/claim-token.service';

function makeClinic(overrides: Partial<ClinicReadModel> = {}): ClinicReadModel {
  return {
    id: 'clinic-1',
    slug: 'test-clinic',
    name: 'Test Clinic',
    about: '',
    providerName: '',
    websiteUrl: '',
    city: null,
    state: null,
    latitude: null,
    longitude: null,
    rating: 5,
    reviewCount: 0,
    telehealthAvailable: false,
    newPatientWait: '',
    consultationFeeBand: '',
    monthlyProgramBand: '',
    financingAvailable: false,
    acceptsInsurance: false,
    status: 'active',
    billingStatus: 'current',
    businessEmail: 'clinic@example.com',
    webhookUrl: 'https://clinic.example.com/hook',
    notifyOnLead: true,
    webhookSecretEncrypted: 'cipher',
    categories: ['hormone'],
    services: [],
    ...overrides,
  };
}

function makeAssessment(overrides: Partial<Assessment> = {}): Assessment {
  return {
    id: 'assessment-1',
    sessionId: 'session_' + '0'.repeat(32),
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
    zipCode: '10001',
    submittedAt: new Date(),
    ...overrides,
  } as Assessment;
}

interface Mocks {
  clinics: jest.Mocked<ClinicRepositoryPort>;
  assessments: jest.Mocked<AssessmentRepositoryPort>;
  leads: jest.Mocked<LeadRepositoryPort>;
  webhook: jest.Mocked<WebhookSenderPort>;
  email: jest.Mocked<EmailSenderPort>;
  encryption: jest.Mocked<EncryptionPort>;
  patients: jest.Mocked<PatientRepositoryPort>;
  claimTokens: ClaimTokenService;
}

function buildMocks(): Mocks {
  const claimTokens = new ClaimTokenService({
    getOrThrow: () => 'test-claim-token-secret-at-least-32-chars!!',
  } as unknown as ConstructorParameters<typeof ClaimTokenService>[0]);

  return {
    clinics: {
      findMatchable: jest.fn(),
      findById: jest.fn(),
      findBySlug: jest.fn(),
    },
    assessments: {
      create: jest.fn(),
      findBySessionId: jest.fn(),
      findLatestByPatientUser: jest.fn(),
      linkToPatient: jest.fn(),
    },
    leads: {
      create: jest.fn().mockResolvedValue({ leadId: 'lead_abc' }),
      recordDelivery: jest.fn().mockResolvedValue(undefined),
      setDeliveryStatus: jest.fn().mockResolvedValue(undefined),
      findByPatientUser: jest.fn(),
    },
    webhook: { send: jest.fn() },
    email: { send: jest.fn().mockResolvedValue(undefined) },
    encryption: {
      encrypt: jest.fn((s: string) => `enc(${s})`),
      decrypt: jest.fn((s: string) => `dec(${s})`),
    },
    patients: {
      findProfile: jest.fn(),
      updateProfile: jest.fn(),
      findPatientIdByUserId: jest.fn().mockResolvedValue(null),
    },
    claimTokens,
  };
}

function buildUseCase(m: Mocks): SubmitLeadUseCase {
  return new SubmitLeadUseCase(
    m.clinics,
    m.assessments,
    m.leads,
    m.webhook,
    m.email,
    m.encryption,
    m.patients,
    m.claimTokens,
  );
}

const BASE_INPUT: SubmitLeadInput = {
  clinicId: 'clinic-1',
  clinicSlug: 'test-clinic',
  patientEmail: 'jane.doe@example.com',
  treatmentCategory: 'hormone',
};

describe('SubmitLeadUseCase', () => {
  it('throws ClinicNotFoundError when neither id nor slug resolves', async () => {
    const m = buildMocks();
    m.clinics.findById.mockResolvedValue(null);
    m.clinics.findBySlug.mockResolvedValue(null);
    const useCase = buildUseCase(m);

    await expect(useCase.execute(BASE_INPUT, {})).rejects.toBeInstanceOf(ClinicNotFoundError);
    expect(m.leads.create).not.toHaveBeenCalled();
  });

  describe('first-name precedence', () => {
    it('prefers request patientFirstName', async () => {
      const m = buildMocks();
      m.clinics.findById.mockResolvedValue(makeClinic({ notifyOnLead: false }));
      m.webhook.send.mockResolvedValue({ ok: true, status: 200 });
      const useCase = buildUseCase(m);

      await useCase.execute(
        { ...BASE_INPUT, patientFirstName: 'Requested' },
        { userId: 'u1', name: 'Jwt Name' },
      );

      expect(m.leads.create).toHaveBeenCalledWith(
        expect.objectContaining({ patientFirstName: 'Requested' }),
      );
    });

    it('falls back to JWT name when no request name', async () => {
      const m = buildMocks();
      m.clinics.findById.mockResolvedValue(makeClinic({ notifyOnLead: false }));
      m.assessments.findLatestByPatientUser.mockResolvedValue(null);
      const useCase = buildUseCase(m);

      await useCase.execute(BASE_INPUT, { userId: 'u1', name: 'Alice Smith' });

      expect(m.leads.create).toHaveBeenCalledWith(
        expect.objectContaining({ patientFirstName: 'Alice' }),
      );
    });

    it('falls back to email prefix when no request name and no JWT name', async () => {
      const m = buildMocks();
      m.clinics.findById.mockResolvedValue(makeClinic({ notifyOnLead: false }));
      const useCase = buildUseCase(m);

      await useCase.execute(BASE_INPUT, {});

      expect(m.leads.create).toHaveBeenCalledWith(
        expect.objectContaining({ patientFirstName: 'jane.doe' }),
      );
    });
  });

  describe('attribution security', () => {
    it('does NOT attach another patient assessment with a bare sessionId (no claimToken)', async () => {
      const m = buildMocks();
      m.clinics.findById.mockResolvedValue(makeClinic({ notifyOnLead: false }));
      // The assessment belongs to some OTHER patient.
      m.assessments.findBySessionId.mockResolvedValue(
        makeAssessment({ id: 'other-assessment', patientId: 'other-patient' }),
      );
      const useCase = buildUseCase(m);

      await useCase.execute(
        { ...BASE_INPUT, sessionId: 'session_' + '0'.repeat(32) },
        {}, // anonymous
      );

      expect(m.leads.create).toHaveBeenCalledWith(
        expect.objectContaining({ assessmentId: null, patientId: null }),
      );
    });

    it('does NOT attach with an INVALID claimToken', async () => {
      const m = buildMocks();
      m.clinics.findById.mockResolvedValue(makeClinic({ notifyOnLead: false }));
      m.assessments.findBySessionId.mockResolvedValue(
        makeAssessment({ id: 'other-assessment', patientId: 'other-patient' }),
      );
      const useCase = buildUseCase(m);

      await useCase.execute(
        { ...BASE_INPUT, sessionId: 'session_' + '0'.repeat(32), claimToken: 'bogus' },
        {},
      );

      expect(m.leads.create).toHaveBeenCalledWith(
        expect.objectContaining({ assessmentId: null, patientId: null }),
      );
    });

    it('attaches the assessment for an anonymous caller with a VALID claimToken', async () => {
      const m = buildMocks();
      const sessionId = 'session_' + '0'.repeat(32);
      const validToken = m.claimTokens.issue(sessionId);
      m.clinics.findById.mockResolvedValue(makeClinic({ notifyOnLead: false }));
      m.assessments.findBySessionId.mockResolvedValue(
        makeAssessment({ id: 'my-assessment', sessionId, patientId: null }),
      );
      const useCase = buildUseCase(m);

      await useCase.execute({ ...BASE_INPUT, sessionId, claimToken: validToken }, {});

      expect(m.leads.create).toHaveBeenCalledWith(
        expect.objectContaining({ assessmentId: 'my-assessment' }),
      );
    });

    it('attaches an assessment the authenticated caller already owns (no token needed)', async () => {
      const m = buildMocks();
      const sessionId = 'session_' + '0'.repeat(32);
      m.clinics.findById.mockResolvedValue(makeClinic({ notifyOnLead: false }));
      m.patients.findPatientIdByUserId.mockResolvedValue('my-patient');
      m.assessments.findBySessionId.mockResolvedValue(
        makeAssessment({ id: 'my-assessment', sessionId, patientId: 'my-patient' }),
      );
      const useCase = buildUseCase(m);

      await useCase.execute({ ...BASE_INPUT, sessionId }, { userId: 'u1' });

      expect(m.leads.create).toHaveBeenCalledWith(
        expect.objectContaining({ assessmentId: 'my-assessment', patientId: 'my-patient' }),
      );
    });

    it('authenticated caller with an UNclaimed assessment + bare sessionId: patient set, assessment NOT linked', async () => {
      // The real production flow: assessment taken anonymously (patientId null,
      // not yet claimed), user signs up, submits the lead WITHOUT a claimToken.
      const m = buildMocks();
      const sessionId = 'session_' + '0'.repeat(32);
      m.clinics.findById.mockResolvedValue(makeClinic({ notifyOnLead: false }));
      m.patients.findPatientIdByUserId.mockResolvedValue('caller-patient');
      m.assessments.findBySessionId.mockResolvedValue(
        makeAssessment({ id: 'unclaimed-assessment', sessionId, patientId: null }),
      );
      const useCase = buildUseCase(m);

      await useCase.execute({ ...BASE_INPUT, sessionId }, { userId: 'u1' });

      // patient resolved directly by userId (NOT null), but assessment is NOT
      // linked because ownership is unproven and no claimToken was supplied.
      expect(m.leads.create).toHaveBeenCalledWith(
        expect.objectContaining({ patientId: 'caller-patient', assessmentId: null }),
      );
    });

    it('authenticated caller with a VALID claimToken: both patient and assessment linked', async () => {
      const m = buildMocks();
      const sessionId = 'session_' + '0'.repeat(32);
      const validToken = m.claimTokens.issue(sessionId);
      m.clinics.findById.mockResolvedValue(makeClinic({ notifyOnLead: false }));
      m.patients.findPatientIdByUserId.mockResolvedValue('caller-patient');
      m.assessments.findBySessionId.mockResolvedValue(
        makeAssessment({ id: 'unclaimed-assessment', sessionId, patientId: null }),
      );
      const useCase = buildUseCase(m);

      await useCase.execute({ ...BASE_INPUT, sessionId, claimToken: validToken }, { userId: 'u1' });

      expect(m.leads.create).toHaveBeenCalledWith(
        expect.objectContaining({
          patientId: 'caller-patient',
          assessmentId: 'unclaimed-assessment',
        }),
      );
    });

    it('anonymous caller with a bare sessionId links nothing', async () => {
      const m = buildMocks();
      const sessionId = 'session_' + '0'.repeat(32);
      m.clinics.findById.mockResolvedValue(makeClinic({ notifyOnLead: false }));
      m.assessments.findBySessionId.mockResolvedValue(
        makeAssessment({ id: 'some-assessment', sessionId, patientId: 'other' }),
      );
      const useCase = buildUseCase(m);

      await useCase.execute({ ...BASE_INPUT, sessionId }, {});

      expect(m.leads.create).toHaveBeenCalledWith(
        expect.objectContaining({ patientId: null, assessmentId: null }),
      );
    });
  });

  describe('delivery status transitions', () => {
    it('email ok + webhook ok → sent_to_crm', async () => {
      const m = buildMocks();
      m.clinics.findById.mockResolvedValue(makeClinic());
      m.webhook.send.mockResolvedValue({ ok: true, status: 200 });
      const useCase = buildUseCase(m);

      await useCase.execute(BASE_INPUT, {});

      expect(m.email.send).toHaveBeenCalled();
      expect(m.leads.recordDelivery).toHaveBeenCalledWith(
        'lead_abc',
        expect.objectContaining({ status: 'success' }),
      );
      expect(m.leads.setDeliveryStatus).toHaveBeenCalledWith(
        'lead_abc',
        'sent_to_crm',
        expect.any(Date),
      );
    });

    it('email ok, no webhook configured → emailed', async () => {
      const m = buildMocks();
      m.clinics.findById.mockResolvedValue(makeClinic({ webhookUrl: null }));
      const useCase = buildUseCase(m);

      await useCase.execute(BASE_INPUT, {});

      expect(m.webhook.send).not.toHaveBeenCalled();
      expect(m.leads.setDeliveryStatus).toHaveBeenCalledWith(
        'lead_abc',
        'emailed',
        expect.any(Date),
      );
    });

    it('webhook fails (no email) → failed but lead still created', async () => {
      const m = buildMocks();
      m.clinics.findById.mockResolvedValue(makeClinic({ businessEmail: null }));
      m.webhook.send.mockResolvedValue({ ok: false, error: 'forbidden_address' });
      const useCase = buildUseCase(m);

      const result = await useCase.execute(BASE_INPUT, {});

      expect(result.leadId).toBe('lead_abc');
      expect(m.leads.recordDelivery).toHaveBeenCalledWith(
        'lead_abc',
        expect.objectContaining({ status: 'failed', error: 'forbidden_address' }),
      );
      expect(m.leads.setDeliveryStatus).toHaveBeenCalledWith(
        'lead_abc',
        'failed',
        expect.any(Date),
      );
    });

    it('does not deliver when clinic notifyOnLead is false', async () => {
      const m = buildMocks();
      m.clinics.findById.mockResolvedValue(makeClinic({ notifyOnLead: false }));
      const useCase = buildUseCase(m);

      await useCase.execute(BASE_INPUT, {});

      expect(m.email.send).not.toHaveBeenCalled();
      expect(m.webhook.send).not.toHaveBeenCalled();
      expect(m.leads.setDeliveryStatus).not.toHaveBeenCalled();
    });

    it('does not deliver when clinic is not active', async () => {
      const m = buildMocks();
      m.clinics.findById.mockResolvedValue(makeClinic({ status: 'suspended' }));
      const useCase = buildUseCase(m);

      await useCase.execute(BASE_INPUT, {});

      expect(m.email.send).not.toHaveBeenCalled();
      expect(m.webhook.send).not.toHaveBeenCalled();
    });
  });
});

import { Test } from '@nestjs/testing';
import { GetLatestAssessmentUseCase } from './get-latest-assessment.use-case';
import { ASSESSMENT_REPOSITORY } from '../domain/ports/assessment-repository.port';
import { ClaimTokenService } from '../domain/claim-token.service';
import type { AssessmentRepositoryPort } from '../domain/ports/assessment-repository.port';
import type { Assessment } from '../domain/assessment.entity';

const mockAssessment: Assessment = {
  id: 'uuid-1',
  sessionId: 'session_abc123',
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
  zipCode: '90210',
  submittedAt: new Date(),
};

describe('GetLatestAssessmentUseCase', () => {
  let useCase: GetLatestAssessmentUseCase;
  let mockRepo: jest.Mocked<AssessmentRepositoryPort>;
  let mockClaimTokenService: jest.Mocked<Pick<ClaimTokenService, 'issue' | 'verify'>>;

  beforeEach(async () => {
    mockRepo = {
      create: jest.fn(),
      findBySessionId: jest.fn(),
      findLatestByPatientUser: jest.fn(),
      linkToPatient: jest.fn<Promise<{ count: number }>, [string, string]>(),
    };

    mockClaimTokenService = {
      issue: jest.fn(),
      verify: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        GetLatestAssessmentUseCase,
        { provide: ASSESSMENT_REPOSITORY, useValue: mockRepo },
        { provide: ClaimTokenService, useValue: mockClaimTokenService },
      ],
    }).compile();

    useCase = module.get(GetLatestAssessmentUseCase);
  });

  it('returns null when no assessment found and no sessionId', async () => {
    mockRepo.findLatestByPatientUser.mockResolvedValue(null);

    const result = await useCase.execute({ userId: 'user-123' });
    expect(result).toBeNull();
    expect(mockRepo.findBySessionId).not.toHaveBeenCalled();
    expect(mockRepo.linkToPatient).not.toHaveBeenCalled();
  });

  it('returns existing assessment when already linked to patient', async () => {
    const linkedAssessment = { ...mockAssessment, patientId: 'patient-123' };
    mockRepo.findLatestByPatientUser.mockResolvedValue(linkedAssessment);

    const result = await useCase.execute({
      userId: 'user-123',
      sessionId: 'session_abc123',
      claimToken: 'token',
    });
    expect(result).toBe(linkedAssessment);
    expect(mockClaimTokenService.verify).not.toHaveBeenCalled();
  });

  it('links anonymous assessment when claimToken verifies and claim succeeds (count=1)', async () => {
    const linkedAssessment = { ...mockAssessment, patientId: 'patient-123' };
    mockRepo.findLatestByPatientUser
      .mockResolvedValueOnce(null) // before link
      .mockResolvedValueOnce(linkedAssessment); // after link
    mockClaimTokenService.verify.mockReturnValue(true);
    mockRepo.linkToPatient.mockResolvedValue({ count: 1 });

    const result = await useCase.execute({
      userId: 'user-123',
      sessionId: 'session_abc123',
      claimToken: 'valid-token',
    });

    expect(mockClaimTokenService.verify).toHaveBeenCalledWith('session_abc123', 'valid-token');
    expect(mockRepo.linkToPatient).toHaveBeenCalledWith('session_abc123', 'user-123');
    expect(mockRepo.findBySessionId).not.toHaveBeenCalled();
    expect(result).toBe(linkedAssessment);
  });

  it('does NOT link when claimToken is wrong', async () => {
    mockRepo.findLatestByPatientUser.mockResolvedValue(null);
    mockClaimTokenService.verify.mockReturnValue(false);

    const result = await useCase.execute({
      userId: 'user-123',
      sessionId: 'session_abc123',
      claimToken: 'wrong-token',
    });

    expect(result).toBeNull();
    expect(mockRepo.linkToPatient).not.toHaveBeenCalled();
    expect(mockRepo.findBySessionId).not.toHaveBeenCalled();
  });

  it('returns null when assessment is already claimed (linkToPatient returns count=0)', async () => {
    mockRepo.findLatestByPatientUser.mockResolvedValue(null);
    mockClaimTokenService.verify.mockReturnValue(true);
    mockRepo.linkToPatient.mockResolvedValue({ count: 0 });

    const result = await useCase.execute({
      userId: 'user-123',
      sessionId: 'session_abc123',
      claimToken: 'valid-token',
    });

    expect(result).toBeNull();
    expect(mockRepo.linkToPatient).toHaveBeenCalledWith('session_abc123', 'user-123');
    expect(mockRepo.findBySessionId).not.toHaveBeenCalled();
  });
});

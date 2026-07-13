import { Test } from '@nestjs/testing';
import { SubmitAssessmentUseCase } from './submit-assessment.use-case';
import { ASSESSMENT_REPOSITORY } from '../domain/ports/assessment-repository.port';
import { ClaimTokenService } from '../domain/claim-token.service';
import { ConsentRequiredError } from '../domain/errors/consent-required.error';
import { InvalidConsentVersionError } from '../domain/errors/invalid-consent-version.error';
import type {
  AssessmentRepositoryPort,
  AssessmentCreateInput,
} from '../domain/ports/assessment-repository.port';

const baseInput: AssessmentCreateInput & { consentGiven: boolean; consentVersion: string } = {
  treatmentCategory: 'hormone',
  selectedGoals: ['goal_energy'],
  selectedSymptoms: ['fatigue'],
  symptomSeverities: { fatigue: 3 },
  budgetBand: '200_500',
  telehealthPreference: 'yes',
  zipCode: '90210',
  chronicConditions: [],
  currentPrescriptions: [],
  consentGiven: true,
  consentVersion: '1.0',
};

describe('SubmitAssessmentUseCase', () => {
  let useCase: SubmitAssessmentUseCase;
  let mockRepo: jest.Mocked<AssessmentRepositoryPort>;
  let mockClaimTokenService: jest.Mocked<Pick<ClaimTokenService, 'issue' | 'verify'>>;

  beforeEach(async () => {
    mockRepo = {
      create: jest.fn().mockResolvedValue({ id: 'uuid-1', sessionId: 'session_abc' }),
      findBySessionId: jest.fn(),
      findLatestByPatientUser: jest.fn(),
      linkToPatient: jest.fn(),
    };

    mockClaimTokenService = {
      issue: jest.fn().mockReturnValue('claim-token-value'),
      verify: jest.fn().mockReturnValue(true),
    };

    const module = await Test.createTestingModule({
      providers: [
        SubmitAssessmentUseCase,
        { provide: ASSESSMENT_REPOSITORY, useValue: mockRepo },
        { provide: ClaimTokenService, useValue: mockClaimTokenService },
      ],
    }).compile();

    useCase = module.get(SubmitAssessmentUseCase);
  });

  it('throws ConsentRequiredError when consentGiven is false', async () => {
    await expect(useCase.execute({ ...baseInput, consentGiven: false }, {})).rejects.toBeInstanceOf(
      ConsentRequiredError,
    );
    expect(mockRepo.create).not.toHaveBeenCalled();
  });

  it('throws InvalidConsentVersionError when consentVersion is not accepted', async () => {
    await expect(
      useCase.execute({ ...baseInput, consentVersion: '2.0' }, {}),
    ).rejects.toBeInstanceOf(InvalidConsentVersionError);
    expect(mockRepo.create).not.toHaveBeenCalled();
  });

  it('calls create with valid input and returns sessionId + claimToken', async () => {
    const result = await useCase.execute(baseInput, { userId: 'user-123' });
    expect(result.sessionId).toBe('session_abc');
    expect(result.claimToken).toBe('claim-token-value');
    expect(mockRepo.create).toHaveBeenCalledWith(baseInput, { userId: 'user-123' });
  });

  it('passes actor.userId through to create when authenticated', async () => {
    await useCase.execute(baseInput, { userId: 'user-xyz' });
    expect(mockRepo.create).toHaveBeenCalledWith(expect.anything(), { userId: 'user-xyz' });
  });

  it('passes empty userId when anonymous', async () => {
    await useCase.execute(baseInput, {});
    expect(mockRepo.create).toHaveBeenCalledWith(expect.anything(), { userId: undefined });
  });
});

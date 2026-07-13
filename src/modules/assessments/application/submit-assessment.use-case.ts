import { Injectable, Inject } from '@nestjs/common';
import {
  ASSESSMENT_REPOSITORY,
  AssessmentRepositoryPort,
  AssessmentCreateInput,
} from '../domain/ports/assessment-repository.port';
import { ClaimTokenService } from '../domain/claim-token.service';
import { ConsentRequiredError } from '../domain/errors/consent-required.error';
import { InvalidConsentVersionError } from '../domain/errors/invalid-consent-version.error';

const ACCEPTED_CONSENT_VERSIONS = ['1.0'];

export interface SubmitAssessmentInput extends AssessmentCreateInput {
  consentGiven: boolean;
  consentVersion: string;
}

export interface SubmitAssessmentOutput {
  sessionId: string;
  claimToken: string;
}

@Injectable()
export class SubmitAssessmentUseCase {
  constructor(
    @Inject(ASSESSMENT_REPOSITORY) private readonly assessmentRepository: AssessmentRepositoryPort,
    private readonly claimTokenService: ClaimTokenService,
  ) {}

  async execute(
    input: SubmitAssessmentInput,
    actor: { userId?: string },
  ): Promise<SubmitAssessmentOutput> {
    if (!input.consentGiven) {
      throw new ConsentRequiredError();
    }

    if (!ACCEPTED_CONSENT_VERSIONS.includes(input.consentVersion)) {
      throw new InvalidConsentVersionError(input.consentVersion);
    }

    const { sessionId } = await this.assessmentRepository.create(input, { userId: actor.userId });
    const claimToken = this.claimTokenService.issue(sessionId);

    return { sessionId, claimToken };
  }
}

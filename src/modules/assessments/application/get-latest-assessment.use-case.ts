import { Injectable, Inject } from '@nestjs/common';
import {
  ASSESSMENT_REPOSITORY,
  AssessmentRepositoryPort,
} from '../domain/ports/assessment-repository.port';
import type { Assessment } from '../domain/assessment.entity';
import { ClaimTokenService } from '../domain/claim-token.service';

export interface GetLatestAssessmentInput {
  userId: string;
  sessionId?: string;
  claimToken?: string;
}

@Injectable()
export class GetLatestAssessmentUseCase {
  constructor(
    @Inject(ASSESSMENT_REPOSITORY) private readonly assessmentRepository: AssessmentRepositoryPort,
    private readonly claimTokenService: ClaimTokenService,
  ) {}

  async execute(input: GetLatestAssessmentInput): Promise<Assessment | null> {
    // First try to find by the authenticated patient's user
    const latest = await this.assessmentRepository.findLatestByPatientUser(input.userId);
    if (latest) {
      return latest;
    }

    // If not found but sessionId and claimToken provided, try to link anonymous assessment
    if (input.sessionId && input.claimToken) {
      const isValid = this.claimTokenService.verify(input.sessionId, input.claimToken);
      if (!isValid) {
        return null;
      }

      // Attempt the atomic conditional claim (only links if patientId IS NULL).
      // If count === 0, the row was already claimed by someone else — return null.
      const { count } = await this.assessmentRepository.linkToPatient(
        input.sessionId,
        input.userId,
      );
      if (count === 0) {
        return null;
      }

      // Re-fetch from patient's context now that it's linked
      return this.assessmentRepository.findLatestByPatientUser(input.userId);
    }

    return null;
  }
}

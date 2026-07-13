import { Injectable, Inject } from '@nestjs/common';
import { RecommendationService } from '../domain/recommendation.service';
import { RecommendationNotFoundError } from '../domain/errors/recommendation-not-found.error';
import {
  ASSESSMENT_REPOSITORY,
  AssessmentRepositoryPort,
} from '../../assessments/domain/ports/assessment-repository.port';
import {
  CLINIC_REPOSITORY,
  ClinicRepositoryPort,
} from '../../clinics/domain/ports/clinic-repository.port';
import { ZipGeocoder } from '../../../infrastructure/geo/zip-geocoder';
import type { ClinicMatchDto } from '../domain/clinic-match.dto';

const SESSION_ID_REGEX = /^session_[0-9a-f]{32}$/;

@Injectable()
export class GetRecommendationsUseCase {
  constructor(
    private readonly recommendationService: RecommendationService,
    @Inject(ASSESSMENT_REPOSITORY) private readonly assessmentRepo: AssessmentRepositoryPort,
    @Inject(CLINIC_REPOSITORY) private readonly clinicRepo: ClinicRepositoryPort,
    private readonly zipGeocoder: ZipGeocoder,
  ) {}

  async execute(sessionId: string): Promise<ClinicMatchDto[]> {
    if (!SESSION_ID_REGEX.test(sessionId)) {
      throw new RecommendationNotFoundError(sessionId);
    }

    const assessment = await this.assessmentRepo.findBySessionId(sessionId);
    if (!assessment) {
      throw new RecommendationNotFoundError(sessionId);
    }

    const [clinics, patientGeo] = await Promise.all([
      this.clinicRepo.findMatchable(assessment.treatmentCategory),
      this.zipGeocoder.lookup(assessment.zipCode),
    ]);

    return this.recommendationService.rank(assessment, clinics, patientGeo);
  }
}

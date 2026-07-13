import { Module } from '@nestjs/common';
import { ClinicsModule } from '../clinics/clinics.module';
import { AssessmentsModule } from '../assessments/assessments.module';
import { GeoModule } from '../../infrastructure/geo/geo.module';
import { RecommendationService } from './domain/recommendation.service';
import { GetRecommendationsUseCase } from './application/get-recommendations.use-case';
import { RecommendationsController } from './infrastructure/http/recommendations.controller';

@Module({
  imports: [ClinicsModule, AssessmentsModule, GeoModule],
  controllers: [RecommendationsController],
  providers: [RecommendationService, GetRecommendationsUseCase],
})
export class RecommendationsModule {}

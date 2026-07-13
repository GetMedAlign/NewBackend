import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../../infrastructure/security/public.decorator';
import { GetRecommendationsUseCase } from '../../application/get-recommendations.use-case';
import type { ClinicMatchDto } from '../../domain/clinic-match.dto';

@ApiTags('recommendations')
@Controller('recommendations')
export class RecommendationsController {
  constructor(private readonly getRecommendations: GetRecommendationsUseCase) {}

  @Public()
  @Get(':sessionId')
  @ApiOperation({ summary: 'Get clinic recommendations for a patient session' })
  @ApiParam({ name: 'sessionId', description: 'Assessment session ID (session_<32 hex>)' })
  @ApiResponse({ status: 200, description: 'Ranked clinic matches (no PHI)' })
  @ApiResponse({ status: 404, description: 'Assessment not found or invalid session ID' })
  async getRecommendationsForSession(
    @Param('sessionId') sessionId: string,
  ): Promise<ClinicMatchDto[]> {
    return this.getRecommendations.execute(sessionId);
  }
}

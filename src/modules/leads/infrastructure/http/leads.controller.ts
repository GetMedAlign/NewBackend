import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { Public } from '../../../../infrastructure/security/public.decorator';
import type { AuthenticatedUser } from '../../../../infrastructure/security/current-user.decorator';
import { SubmitLeadUseCase } from '../../application/submit-lead.use-case';
import { SubmitLeadDto } from './dtos/submit-lead.dto';

@ApiTags('leads')
@Controller('leads')
export class LeadsController {
  constructor(private readonly submitLead: SubmitLeadUseCase) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit a lead to a clinic (anonymous or authenticated)' })
  @ApiResponse({ status: 200, description: 'Lead created; returns the lead id.' })
  @ApiResponse({ status: 404, description: 'Clinic not found.' })
  async submit(
    @Body() dto: SubmitLeadDto,
    @Req() req: Request & { user?: AuthenticatedUser },
  ): Promise<{ leadId: string }> {
    const actor = req.user ? { userId: req.user.sub } : {};

    return this.submitLead.execute(
      {
        clinicId: dto.clinicId,
        clinicSlug: dto.clinicSlug,
        patientEmail: dto.patientEmail,
        patientFirstName: dto.patientFirstName ?? null,
        treatmentCategory: dto.treatmentCategory,
        patientZip: dto.patientZip ?? null,
        topGoals: dto.topGoals ?? null,
        topSymptoms: dto.topSymptoms ?? null,
        budgetBand: dto.budgetBand ?? null,
        telehealthPreference: dto.telehealthPreference ?? null,
        appointmentPreference: dto.appointmentPreference ?? null,
        startTimeline: dto.startTimeline ?? null,
        sessionId: dto.sessionId ?? null,
        claimToken: dto.claimToken ?? null,
      },
      actor,
    );
  }
}

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { Public } from '../../../../infrastructure/security/public.decorator';
import { CurrentUser } from '../../../../infrastructure/security/current-user.decorator';
import type { AuthenticatedUser } from '../../../../infrastructure/security/current-user.decorator';
import { AUDIT } from '../../../auth/domain/ports/audit.port';
import type { AuditPort } from '../../../auth/domain/ports/audit.port';

import { SubmitAssessmentUseCase } from '../../application/submit-assessment.use-case';
import { GetLatestAssessmentUseCase } from '../../application/get-latest-assessment.use-case';
import { SubmitAssessmentDto } from './dtos/submit-assessment.dto';
import type { LatestAssessmentResponseDto } from './dtos/latest-assessment-response.dto';
import type { Assessment } from '../../domain/assessment.entity';

@Controller('assessments')
export class AssessmentsController {
  constructor(
    private readonly submitAssessment: SubmitAssessmentUseCase,
    private readonly getLatestAssessment: GetLatestAssessmentUseCase,
    @Inject(AUDIT) private readonly audit: AuditPort,
  ) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async submit(
    @Body() dto: SubmitAssessmentDto,
    @Req() req: Request & { user?: AuthenticatedUser },
  ): Promise<{ sessionId: string; claimToken: string }> {
    const actor = req.user ? { userId: req.user.sub } : {};

    const result = await this.submitAssessment.execute(
      {
        treatmentCategory: dto.treatmentCategory,
        selectedGoals: dto.selectedGoals,
        selectedSymptoms: dto.selectedSymptoms,
        symptomSeverities: dto.symptomSeverities,
        symptomDuration: dto.symptomDuration ?? null,
        hasPriorTreatment: dto.hasPriorTreatment ?? null,
        exerciseFrequency: dto.exerciseFrequency ?? null,
        diet: dto.diet ?? null,
        sleepHours: dto.sleepHours ?? null,
        stressLevel: dto.stressLevel ?? null,
        alcoholUse: dto.alcoholUse ?? null,
        willingLabWork: dto.willingLabWork ?? null,
        willingStructuredProgram: dto.willingStructuredProgram ?? null,
        appointmentPreference: dto.appointmentPreference ?? null,
        startTimeline: dto.startTimeline ?? null,
        budgetBand: dto.budgetBand,
        telehealthPreference: dto.telehealthPreference,
        biologicalSex: dto.biologicalSex ?? null,
        pregnantOrPlanning: dto.pregnantOrPlanning ?? null,
        takingPrescriptions: dto.takingPrescriptions ?? null,
        hadPriorTherapy: dto.hadPriorTherapy ?? null,
        medicationAllergies: dto.medicationAllergies ?? null,
        allergyDetails: dto.allergyDetails ?? null,
        chronicConditions: dto.chronicConditions,
        currentPrescriptions: dto.currentPrescriptions,
        otherMedications: dto.otherMedications ?? null,
        zipCode: dto.zipCode,
        consentGiven: dto.consentGiven,
        consentVersion: dto.consentVersion,
      },
      actor,
    );

    await this.audit.record({
      actorUserId: req.user?.sub ?? null,
      actorRole: req.user?.role ?? 'anonymous',
      ip: req.ip ?? null,
      actionType: 'assessment_created',
      affectedRecord: `patient_assessments:${result.sessionId}`,
    });

    return result;
  }

  @Get('latest')
  @HttpCode(HttpStatus.OK)
  async getLatest(
    @CurrentUser() user: AuthenticatedUser,
    @Query('sessionId') sessionId?: string,
    @Query('claimToken') claimToken?: string,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<LatestAssessmentResponseDto | void> {
    const assessment = await this.getLatestAssessment.execute({
      userId: user.sub,
      sessionId,
      claimToken,
    });

    if (!assessment) {
      res?.status(HttpStatus.NO_CONTENT);
      return;
    }

    return this.toResponseDto(assessment);
  }

  private toResponseDto(a: Assessment): LatestAssessmentResponseDto {
    return {
      sessionId: a.sessionId,
      treatmentCategory: a.treatmentCategory,
      selectedGoals: a.selectedGoals,
      selectedSymptoms: a.selectedSymptoms,
      symptomSeverities: a.symptomSeverities,
      symptomDuration: a.symptomDuration,
      hasPriorTreatment: a.hasPriorTreatment,
      exerciseFrequency: a.exerciseFrequency,
      diet: a.diet,
      sleepHours: a.sleepHours,
      stressLevel: a.stressLevel,
      alcoholUse: a.alcoholUse,
      willingLabWork: a.willingLabWork,
      willingStructuredProgram: a.willingStructuredProgram,
      appointmentPreference: a.appointmentPreference,
      startTimeline: a.startTimeline,
      budgetBand: a.budgetBand,
      telehealthPreference: a.telehealthPreference,
      biologicalSex: a.biologicalSex,
      pregnantOrPlanning: a.pregnantOrPlanning,
      takingPrescriptions: a.takingPrescriptions,
      hadPriorTherapy: a.hadPriorTherapy,
      medicationAllergies: a.medicationAllergies,
      allergyDetails: a.allergyDetails,
      chronicConditions: a.chronicConditions,
      currentPrescriptions: a.currentPrescriptions,
      otherMedications: a.otherMedications,
      zipCode: a.zipCode,
    };
  }
}

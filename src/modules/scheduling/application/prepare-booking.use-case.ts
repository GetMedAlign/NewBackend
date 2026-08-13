import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { CLINIC_REPOSITORY } from '../../clinics/domain/ports/clinic-repository.port';
import type { ClinicRepositoryPort } from '../../clinics/domain/ports/clinic-repository.port';
import { ClinicNotFoundError } from '../../clinics/domain/errors/clinic-not-found.error';
import { PATIENT_REPOSITORY } from '../../patients/domain/ports/patient-repository.port';
import type { PatientRepositoryPort } from '../../patients/domain/ports/patient-repository.port';
import { PatientNotFoundError } from '../../patients/domain/errors/patient-not-found.error';
import { LEAD_REPOSITORY } from '../../leads/domain/ports/lead-repository.port';
import type { LeadRepositoryPort } from '../../leads/domain/ports/lead-repository.port';
import { SubmitLeadUseCase } from '../../leads/application/submit-lead.use-case';
import { GetLatestAssessmentUseCase } from '../../assessments/application/get-latest-assessment.use-case';
import { ENCRYPTION_PORT } from '../../auth/domain/ports/encryption.port';
import type { EncryptionPort } from '../../auth/domain/ports/encryption.port';

export type BookingProvider = 'request' | 'calendly';

export interface BookingContext {
  provider: BookingProvider;
  schedulingUrl: string | null;
  trackingToken: string | null;
  inviteeName: string | null;
  inviteeEmail: string | null;
}

/**
 * Prepares the patient-facing booking context for a clinic (Scheduling
 * Slice 4). When the clinic has not connected Calendly, tells the frontend
 * to fall back to request-to-book. When it has, ensures a lead exists for
 * the patient (reusing the latest one for this clinic + email, or minting
 * one from their latest assessment) and mints an encrypted tracking token
 * (`EncryptionPort.encrypt(\`${leadId}:${clinicId}\`)`) the frontend passes to
 * Calendly as `utm_content`, so the webhook (Slice 2/4) can decrypt it and
 * link the booking back to the lead. Never returns a Calendly OAuth token
 * or webhook signing key: only the public scheduling URL and an opaque,
 * authenticated ciphertext blob.
 */
@Injectable()
export class PrepareBookingUseCase {
  constructor(
    @Inject(CLINIC_REPOSITORY) private readonly clinics: ClinicRepositoryPort,
    @Inject(PATIENT_REPOSITORY) private readonly patients: PatientRepositoryPort,
    @Inject(LEAD_REPOSITORY) private readonly leads: LeadRepositoryPort,
    @Inject(ENCRYPTION_PORT) private readonly encryption: EncryptionPort,
    private readonly submitLead: SubmitLeadUseCase,
    private readonly getLatestAssessment: GetLatestAssessmentUseCase,
  ) {}

  async execute(params: { userId: string; slug: string }): Promise<BookingContext> {
    const clinic = await this.clinics.findBySlug(params.slug);
    if (!clinic) {
      throw new ClinicNotFoundError(params.slug);
    }

    if (clinic.schedulingProvider !== 'calendly' || !clinic.calendlySchedulingUrl) {
      return {
        provider: 'request',
        schedulingUrl: null,
        trackingToken: null,
        inviteeName: null,
        inviteeEmail: null,
      };
    }

    const profile = await this.patients.findProfile(params.userId);
    if (!profile) {
      // Shouldn't happen for an authenticated user; mirrors GetProfileUseCase.
      throw new NotFoundException('Account not found.');
    }
    if (profile.hasPatient && profile.isDeleted) {
      throw new PatientNotFoundError();
    }

    const inviteeName = profile.name;
    const inviteeEmail = profile.email;

    const leadId = await this.ensureLeadId(params.userId, clinic.id, inviteeEmail, inviteeName);
    const trackingToken = leadId ? this.encryption.encrypt(`${leadId}:${clinic.id}`) : null;

    return {
      provider: 'calendly',
      schedulingUrl: clinic.calendlySchedulingUrl,
      trackingToken,
      inviteeName,
      inviteeEmail,
    };
  }

  /**
   * Reuses the patient's most recent lead for this clinic if one exists;
   * otherwise mints one from their latest assessment (if they have one). If
   * they have neither, returns null: booking still works, it just will not
   * link to a lead (the webhook falls back to email matching).
   */
  private async ensureLeadId(
    userId: string,
    clinicId: string,
    patientEmail: string,
    patientName: string | null,
  ): Promise<string | null> {
    const existing = await this.leads.findLatestByClinicAndEmail(clinicId, patientEmail);
    if (existing) {
      return existing.leadId;
    }

    const assessment = await this.getLatestAssessment.execute({ userId });
    if (!assessment) {
      return null;
    }

    const { leadId } = await this.submitLead.execute(
      {
        clinicId,
        patientEmail,
        treatmentCategory: assessment.treatmentCategory,
        patientZip: assessment.zipCode,
        topGoals: assessment.selectedGoals,
        topSymptoms: assessment.selectedSymptoms,
        budgetBand: assessment.budgetBand,
        telehealthPreference: assessment.telehealthPreference,
        appointmentPreference: assessment.appointmentPreference,
        startTimeline: assessment.startTimeline,
      },
      { userId, name: patientName ?? undefined },
    );

    return leadId;
  }
}

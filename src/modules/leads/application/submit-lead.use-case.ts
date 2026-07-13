import { Inject, Injectable } from '@nestjs/common';

import { CLINIC_REPOSITORY } from '../../clinics/domain/ports/clinic-repository.port';
import type { ClinicRepositoryPort } from '../../clinics/domain/ports/clinic-repository.port';
import type { ClinicReadModel } from '../../clinics/domain/clinic.entity';
import { ASSESSMENT_REPOSITORY } from '../../assessments/domain/ports/assessment-repository.port';
import type { AssessmentRepositoryPort } from '../../assessments/domain/ports/assessment-repository.port';
import { ClaimTokenService } from '../../assessments/domain/claim-token.service';
import { ENCRYPTION_PORT } from '../../auth/domain/ports/encryption.port';
import type { EncryptionPort } from '../../auth/domain/ports/encryption.port';
import { EMAIL_SENDER } from '../../auth/infrastructure/adapters/email-sender.port';
import type { EmailSenderPort } from '../../auth/infrastructure/adapters/email-sender.port';
import { PATIENT_REPOSITORY } from '../../patients/domain/ports/patient-repository.port';
import type { PatientRepositoryPort } from '../../patients/domain/ports/patient-repository.port';

import { LEAD_REPOSITORY } from '../domain/ports/lead-repository.port';
import type { LeadRepositoryPort, LeadDeliveryStatus } from '../domain/ports/lead-repository.port';
import { WEBHOOK_SENDER } from '../domain/ports/webhook-sender.port';
import type { WebhookSenderPort } from '../domain/ports/webhook-sender.port';
import { ClinicNotFoundError } from '../domain/errors/clinic-not-found.error';

export interface SubmitLeadInput {
  clinicId?: string | null;
  clinicSlug?: string | null;
  patientEmail: string;
  patientFirstName?: string | null;
  treatmentCategory: string;
  patientZip?: string | null;
  topGoals?: string[] | null;
  topSymptoms?: string[] | null;
  budgetBand?: string | null;
  telehealthPreference?: string | null;
  appointmentPreference?: string | null;
  startTimeline?: string | null;
  patientPhone?: string | null;
  sessionId?: string | null;
  claimToken?: string | null;
}

export interface SubmitLeadActor {
  userId?: string;
  /** Display name from the JWT, if the token carries one. */
  name?: string;
}

export interface SubmitLeadOutput {
  leadId: string;
}

/** HTML-escapes a value for safe interpolation into an HTML email body. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

@Injectable()
export class SubmitLeadUseCase {
  constructor(
    @Inject(CLINIC_REPOSITORY) private readonly clinics: ClinicRepositoryPort,
    @Inject(ASSESSMENT_REPOSITORY) private readonly assessments: AssessmentRepositoryPort,
    @Inject(LEAD_REPOSITORY) private readonly leads: LeadRepositoryPort,
    @Inject(WEBHOOK_SENDER) private readonly webhook: WebhookSenderPort,
    @Inject(EMAIL_SENDER) private readonly email: EmailSenderPort,
    @Inject(ENCRYPTION_PORT) private readonly encryption: EncryptionPort,
    @Inject(PATIENT_REPOSITORY) private readonly patients: PatientRepositoryPort,
    private readonly claimTokens: ClaimTokenService,
  ) {}

  async execute(input: SubmitLeadInput, actor: SubmitLeadActor): Promise<SubmitLeadOutput> {
    const clinic = await this.resolveClinic(input);
    if (!clinic) {
      throw new ClinicNotFoundError(input.clinicId ?? input.clinicSlug ?? 'unknown');
    }

    const firstName = this.resolveFirstName(input, actor);

    const { assessmentId, patientId } = await this.resolveAttribution(input, actor);

    const { leadId } = await this.leads.create({
      clinicId: clinic.id,
      assessmentId,
      patientId,
      patientFirstName: firstName,
      patientEmail: input.patientEmail,
      patientZip: input.patientZip ?? null,
      treatmentCategory: input.treatmentCategory,
      topGoals: joinCsv(input.topGoals),
      topSymptoms: joinCsv(input.topSymptoms),
      budgetBand: input.budgetBand ?? null,
      telehealthPreference: input.telehealthPreference ?? null,
      appointmentPreference: input.appointmentPreference ?? null,
      startTimeline: input.startTimeline ?? null,
      patientPhone: input.patientPhone ?? null,
    });

    await this.deliver(leadId, clinic, firstName, input.patientEmail);

    return { leadId };
  }

  private async resolveClinic(input: SubmitLeadInput): Promise<ClinicReadModel | null> {
    if (input.clinicId) {
      const byId = await this.clinics.findById(input.clinicId);
      if (byId) return byId;
    }
    if (input.clinicSlug) {
      const bySlug = await this.clinics.findBySlug(input.clinicSlug);
      if (bySlug) return bySlug;
    }
    return null;
  }

  private resolveFirstName(input: SubmitLeadInput, actor: SubmitLeadActor): string {
    const provided = input.patientFirstName?.trim();
    if (provided) return provided;

    const jwtName = actor.name?.trim();
    if (jwtName) {
      const first = jwtName.split(/\s+/)[0];
      if (first) return first;
    }

    return input.patientEmail.split('@')[0];
  }

  /**
   * Determines the lead's attribution links. NEVER attaches another patient's
   * assessment without proof:
   *   - Authenticated caller: link to their own patient. Link the assessment
   *     only if it already belongs to them, or a valid claimToken proves it.
   *   - Anonymous caller: link the assessment (and its patient, if any) only
   *     when a valid claimToken verifies the sessionId.
   * A bare sessionId with no/invalid claimToken links nothing.
   */
  private async resolveAttribution(
    input: SubmitLeadInput,
    actor: SubmitLeadActor,
  ): Promise<{ assessmentId: string | null; patientId: string | null }> {
    const sessionId = input.sessionId?.trim() || null;
    const hasValidClaim =
      sessionId != null &&
      !!input.claimToken &&
      this.claimTokens.verify(sessionId, input.claimToken);

    if (actor.userId) {
      // Resolve the authenticated caller's own patient directly by userId
      // (matching .NET), so the lead is attributed to them even when they have
      // not yet claimed the assessment.
      const callerPatientId = await this.patients.findPatientIdByUserId(actor.userId);

      let assessmentId: string | null = null;
      if (sessionId) {
        const assessment = await this.assessments.findBySessionId(sessionId);
        if (assessment) {
          const ownsAssessment =
            callerPatientId != null && assessment.patientId === callerPatientId;
          if (ownsAssessment || hasValidClaim) {
            assessmentId = assessment.id;
          }
        }
      }

      return { assessmentId, patientId: callerPatientId };
    }

    // Anonymous: proof required to link anything.
    if (sessionId && hasValidClaim) {
      const assessment = await this.assessments.findBySessionId(sessionId);
      if (assessment) {
        return { assessmentId: assessment.id, patientId: assessment.patientId };
      }
    }

    return { assessmentId: null, patientId: null };
  }

  private async deliver(
    leadId: string,
    clinic: ClinicReadModel,
    firstName: string,
    patientEmail: string,
  ): Promise<void> {
    if (!clinic.notifyOnLead || clinic.status !== 'active') {
      return;
    }

    let emailed = false;
    let sentToCrm = false;
    let attempted = false;

    // Email notification — fires whenever a business email is configured.
    if (clinic.businessEmail) {
      attempted = true;
      try {
        const subject = `New MedAlign lead: ${firstName}`;
        const html = this.buildEmailHtml(clinic.name, firstName, patientEmail);
        await this.email.send(clinic.businessEmail, subject, html);
        emailed = true;
      } catch {
        // A delivery failure must not fail the request.
      }
    }

    // Webhook (CRM) — signed + SSRF-guarded, single attempt.
    if (clinic.webhookUrl) {
      attempted = true;
      const secret = clinic.webhookSecretEncrypted
        ? this.encryption.decrypt(clinic.webhookSecretEncrypted)
        : '';
      const payload = {
        leadId,
        clinicId: clinic.id,
        clinicSlug: clinic.slug,
        patientFirstName: firstName,
        patientEmail,
        treatmentCategory: clinic.categories[0] ?? null,
      };

      const result = await this.webhook.send(clinic.webhookUrl, payload, secret);
      await this.leads.recordDelivery(leadId, {
        url: clinic.webhookUrl,
        status: result.ok ? 'success' : 'failed',
        responseCode: result.status ?? null,
        error: result.ok ? null : (result.error ?? 'delivery_failed'),
      });
      if (result.ok) sentToCrm = true;
    }

    if (!attempted) {
      return;
    }

    let status: LeadDeliveryStatus;
    if (sentToCrm) {
      status = 'sent_to_crm';
    } else if (emailed) {
      status = 'emailed';
    } else {
      status = 'failed';
    }

    await this.leads.setDeliveryStatus(leadId, status, new Date());
  }

  private buildEmailHtml(clinicName: string, firstName: string, patientEmail: string): string {
    const name = escapeHtml(clinicName);
    const patient = escapeHtml(firstName);
    const emailAddr = escapeHtml(patientEmail);
    return (
      `<p>Hello ${name},</p>` +
      `<p>You have a new lead from <strong>${patient}</strong> (${emailAddr}).</p>` +
      `<p>Sign in to your MedAlign dashboard to view the full details.</p>`
    );
  }
}

function joinCsv(values: string[] | null | undefined): string | null {
  if (!values || values.length === 0) return null;
  return values.join(',');
}

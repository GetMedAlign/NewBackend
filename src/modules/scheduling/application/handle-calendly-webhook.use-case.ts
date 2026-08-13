import { Inject, Injectable, Logger } from '@nestjs/common';
import { SCHEDULING_REPOSITORY } from '../domain/ports/scheduling-repository.port';
import type { SchedulingRepositoryPort } from '../domain/ports/scheduling-repository.port';
import { CALENDLY_WEBHOOK_VERIFIER } from '../domain/ports/calendly-webhook-verifier.port';
import type { CalendlyWebhookVerifierPort } from '../domain/ports/calendly-webhook-verifier.port';
import { APPOINTMENT_REPOSITORY } from '../domain/ports/appointment-repository.port';
import type { AppointmentRepositoryPort } from '../domain/ports/appointment-repository.port';
import { ENCRYPTION_PORT } from '../../auth/domain/ports/encryption.port';
import type { EncryptionPort } from '../../auth/domain/ports/encryption.port';
import { LEAD_REPOSITORY } from '../../leads/domain/ports/lead-repository.port';
import type { LeadRepositoryPort } from '../../leads/domain/ports/lead-repository.port';
import { decodeTrackingToken } from './tracking-token';

type CalendlyWebhookPayload = {
  email?: string;
  name?: string;
  uri?: string;
  tracking?: { utm_content?: string | null } | null;
  scheduled_event?: {
    uri?: string;
    start_time?: string;
    end_time?: string;
  } | null;
};

type CalendlyWebhookBody = {
  event?: string;
  payload?: CalendlyWebhookPayload;
};

/**
 * Handles `POST /scheduling/calendly/webhook/:clinicId` deliveries
 * (Scheduling Slice 2 §3): verifies the signature first, then processes
 * `invitee.created` (creates the appointment, books the linked lead) and
 * `invitee.canceled` (cancels the appointment, reverts the lead). Every
 * other event, and every unconnected/unknown clinic, is ignored quietly:
 * this never throws for anything except a bad signature, so Calendly never
 * sees a retry storm for events it doesn't need to redeliver.
 *
 * Nothing is written until the signature has been verified: a bad signature
 * throws (propagated from the verifier, mapped to a 400 by the controller)
 * before the scheduling repo, appointment repo, or lead repo are touched.
 */
@Injectable()
export class HandleCalendlyWebhookUseCase {
  private readonly logger = new Logger(HandleCalendlyWebhookUseCase.name);

  constructor(
    @Inject(SCHEDULING_REPOSITORY) private readonly schedulingRepo: SchedulingRepositoryPort,
    @Inject(CALENDLY_WEBHOOK_VERIFIER) private readonly verifier: CalendlyWebhookVerifierPort,
    @Inject(APPOINTMENT_REPOSITORY) private readonly appointments: AppointmentRepositoryPort,
    @Inject(ENCRYPTION_PORT) private readonly encryption: EncryptionPort,
    @Inject(LEAD_REPOSITORY) private readonly leads: LeadRepositoryPort,
  ) {}

  async handle(clinicId: string, rawBody: Buffer, signatureHeader: string): Promise<void> {
    const state = await this.schedulingRepo.getWebhookVerificationState(clinicId);
    if (state.provider !== 'calendly' || !state.signingKeyEncrypted) {
      this.logger.warn(`Ignoring Calendly webhook for unconnected clinic=${clinicId}`);
      return;
    }

    const signingKey = this.encryption.decrypt(state.signingKeyEncrypted);
    // Throws (e.g. BadRequestException) on any missing/malformed/stale/
    // mismatched signature; propagated untouched to the caller, no writes
    // happen before or as a result of that failure.
    this.verifier.verify(rawBody, signatureHeader, signingKey);

    let body: CalendlyWebhookBody;
    try {
      body = JSON.parse(rawBody.toString('utf8')) as CalendlyWebhookBody;
    } catch {
      this.logger.warn(`Ignoring Calendly webhook with unparseable body for clinic=${clinicId}`);
      return;
    }

    const { event, payload } = body;
    if (!payload) {
      this.logger.warn(`Ignoring Calendly webhook with no payload for clinic=${clinicId}`);
      return;
    }

    switch (event) {
      case 'invitee.created':
        await this.handleInviteeCreated(clinicId, payload);
        return;
      case 'invitee.canceled':
        await this.handleInviteeCanceled(clinicId, payload);
        return;
      default:
        this.logger.log(`Ignoring unhandled Calendly webhook event=${String(event)}`);
        return;
    }
  }

  private async handleInviteeCreated(
    clinicId: string,
    payload: CalendlyWebhookPayload,
  ): Promise<void> {
    const inviteeUri = payload.uri;
    const inviteeEmail = payload.email;
    const calendlyEventUri = payload.scheduled_event?.uri;
    const startTimeRaw = payload.scheduled_event?.start_time;

    if (!inviteeUri || !inviteeEmail || !calendlyEventUri || !startTimeRaw) {
      this.logger.warn(
        `Ignoring Calendly invitee.created with missing uri/email/event/start_time for clinic=${clinicId}`,
      );
      return;
    }
    const startTime = new Date(startTimeRaw);
    const endTimeRaw = payload.scheduled_event?.end_time;
    const endTime = endTimeRaw ? new Date(endTimeRaw) : null;

    const leadId = await this.resolveLeadId(clinicId, payload);
    const patientId = leadId ? await this.leads.findPatientIdByLeadId(leadId) : null;

    await this.appointments.createIfAbsent({
      clinicId,
      leadId,
      patientId,
      inviteeEmail,
      inviteeName: payload.name ?? null,
      calendlyEventUri,
      calendlyInviteeUri: inviteeUri,
      startTime,
      endTime,
      status: 'booked',
    });

    if (leadId) {
      await this.leads.setBookedScheduled(leadId, startTime);
    }
  }

  private async handleInviteeCanceled(
    clinicId: string,
    payload: CalendlyWebhookPayload,
  ): Promise<void> {
    const inviteeUri = payload.uri;
    if (!inviteeUri) {
      this.logger.warn('Ignoring Calendly invitee.canceled with no invitee uri');
      return;
    }

    // Scoped to (clinicId, inviteeUri): a validly-signed webhook for this
    // clinic can only cancel an appointment this clinic actually owns. The
    // returned leadId comes from the DB row itself, not the tracking token,
    // so a forged/mismatched token can't cause a cross-clinic revert below.
    // Null means no owned appointment matched, so there is nothing to revert.
    const leadId = await this.appointments.cancelByInviteeUri(clinicId, inviteeUri);
    if (!leadId) return;

    // Calendly reschedules deliver invitee.created (new invitee URI, same
    // lead) followed by invitee.canceled (old invitee URI). If the lead
    // still has another booked appointment, this cancellation is just the
    // old slot going away as part of that reschedule, not the lead actually
    // un-booking, so don't revert its status.
    const hasOtherBooking = await this.appointments.hasOtherBookedAppointment(
      clinicId,
      leadId,
      inviteeUri,
    );
    if (!hasOtherBooking) {
      await this.leads.revertBooking(leadId);
    }
  }

  /**
   * Resolves the lead a booking belongs to: prefer the tracking token (only
   * when it decodes AND its clinicId matches the URL clinicId, an
   * unforgeable, cross-clinic-safe signal), else fall back to the most
   * recent lead for this clinic + invitee email.
   */
  private async resolveLeadId(
    clinicId: string,
    payload: CalendlyWebhookPayload,
  ): Promise<string | null> {
    const decoded = decodeTrackingToken(this.encryption, payload.tracking?.utm_content);
    if (decoded && decoded.clinicId === clinicId) {
      return decoded.leadId;
    }

    if (!payload.email) return null;
    const fallback = await this.leads.findLatestByClinicAndEmail(clinicId, payload.email);
    return fallback?.leadId ?? null;
  }
}

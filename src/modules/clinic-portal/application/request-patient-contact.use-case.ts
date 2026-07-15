import {
  Injectable,
  Inject,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { CLINIC_LEAD_REPOSITORY } from '../domain/ports/clinic-lead-repository.port';
import type { ClinicLeadRepositoryPort } from '../domain/ports/clinic-lead-repository.port';
import { EMAIL_SENDER } from '../../auth/infrastructure/adapters/email-sender.port';
import type { EmailSenderPort } from '../../auth/infrastructure/adapters/email-sender.port';

@Injectable()
export class RequestPatientContactUseCase {
  constructor(
    @Inject(CLINIC_LEAD_REPOSITORY)
    private readonly repo: ClinicLeadRepositoryPort,
    @Inject(EMAIL_SENDER)
    private readonly emailSender: EmailSenderPort,
  ) {}

  async execute(clinicId: string, leadId: string): Promise<void> {
    const lead = await this.repo.findByClinic(clinicId, leadId);
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }

    const subject = `${lead.clinicName} would like to connect with you`;
    const websitePart = lead.clinicWebsiteUrl ? ` (${lead.clinicWebsiteUrl})` : '';
    const body = [
      `Hello ${lead.patientFirstName},`,
      '',
      `${lead.clinicName}${websitePart} has reviewed your inquiry and would like to get in touch with you.`,
      '',
      'A member of their team will be reaching out to you soon.',
      '',
      'Best regards,',
      `The ${lead.clinicName} Team`,
    ].join('\n');

    try {
      await this.emailSender.send(lead.patientEmail, subject, body);
    } catch (err: unknown) {
      throw new InternalServerErrorException(
        `Failed to send contact request email: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

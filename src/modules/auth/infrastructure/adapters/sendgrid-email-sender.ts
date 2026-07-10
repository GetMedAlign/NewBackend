import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sgMail from '@sendgrid/mail';
import type { EmailSenderPort } from './email-sender.port';
import type { Env } from '../../../../infrastructure/config/env.schema';

@Injectable()
export class SendGridEmailSender implements EmailSenderPort {
  private readonly fromEmail: string;

  constructor(private readonly configService: ConfigService<Env, true>) {
    const apiKey = this.configService.getOrThrow<string>('SENDGRID_API_KEY');
    this.fromEmail = this.configService.getOrThrow<string>('SENDGRID_FROM_EMAIL');
    sgMail.setApiKey(apiKey);
  }

  async send(to: string, subject: string, body: string): Promise<void> {
    await sgMail.send({
      to,
      from: this.fromEmail,
      subject,
      text: body,
    });
  }
}

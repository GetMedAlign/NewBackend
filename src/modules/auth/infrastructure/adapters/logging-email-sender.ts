import { Injectable, Logger } from '@nestjs/common';
import type { EmailSenderPort } from './email-sender.port';

/**
 * Development-only email sender that logs emails to the console instead of
 * calling SendGrid. Used when NODE_ENV is 'development' or 'test'.
 */
@Injectable()
export class LoggingEmailSender implements EmailSenderPort {
  private readonly logger = new Logger(LoggingEmailSender.name);

  async send(to: string, subject: string, body: string): Promise<void> {
    this.logger.log(`[DEV EMAIL] to=${to} subject=${subject} body=${body}`);
  }
}

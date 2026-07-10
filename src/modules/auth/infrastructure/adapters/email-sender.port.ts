export interface EmailSenderPort {
  send(to: string, subject: string, body: string): Promise<void>;
}

export const EMAIL_SENDER = Symbol('EmailSenderPort');

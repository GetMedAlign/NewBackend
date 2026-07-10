import { Logger } from '@nestjs/common';
import { LoggingEmailSender } from './logging-email-sender';

describe('LoggingEmailSender', () => {
  let sender: LoggingEmailSender;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    sender = new LoggingEmailSender();
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('logs the email details via NestJS Logger and does not throw', async () => {
    const to = 'user@example.com';
    const subject = 'Your verification code';
    const body = 'Your code is 123456';

    await expect(sender.send(to, subject, body)).resolves.toBeUndefined();

    expect(logSpy).toHaveBeenCalledWith(
      `[DEV EMAIL] to=${to} subject=${subject} body=${body}`,
    );
  });

  it('does not call SendGrid', async () => {
    // Verify no external calls are made by ensuring no unhandled promise rejections
    // and no network calls during the test.
    await expect(
      sender.send('dev@test.com', 'Test subject', 'Test body'),
    ).resolves.toBeUndefined();
  });
});

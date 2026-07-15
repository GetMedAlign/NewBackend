import { ConfigService } from '@nestjs/config';
import { ForgotPasswordUseCase } from './forgot-password.use-case';
import type { PasswordResetRepositoryPort } from '../domain/ports/password-reset-repository.port';
import type { EmailSenderPort } from '../infrastructure/adapters/email-sender.port';

const makeResetRepo = (): jest.Mocked<PasswordResetRepositoryPort> => ({
  findUserIdByEmail: jest.fn().mockResolvedValue(null),
  issue: jest.fn().mockResolvedValue(undefined),
  findValidByEmail: jest.fn().mockResolvedValue(null),
  consume: jest.fn().mockResolvedValue(undefined),
  updatePasswordHash: jest.fn().mockResolvedValue(undefined),
});

const makeEmailSender = (): jest.Mocked<EmailSenderPort> => ({
  send: jest.fn().mockResolvedValue(undefined),
});

const makeConfig = (baseUrl = 'https://example.com'): jest.Mocked<ConfigService> => {
  return {
    get: jest.fn().mockReturnValue(baseUrl),
  } as unknown as jest.Mocked<ConfigService>;
};

describe('ForgotPasswordUseCase', () => {
  let useCase: ForgotPasswordUseCase;
  let resetRepo: jest.Mocked<PasswordResetRepositoryPort>;
  let emailSender: jest.Mocked<EmailSenderPort>;
  let config: jest.Mocked<ConfigService>;

  beforeEach(() => {
    resetRepo = makeResetRepo();
    emailSender = makeEmailSender();
    config = makeConfig();
    useCase = new ForgotPasswordUseCase(resetRepo, emailSender, config);
  });

  it('returns { success: true } for an unknown email WITHOUT calling issue', async () => {
    resetRepo.findUserIdByEmail.mockResolvedValue(null);

    const result = await useCase.execute({ email: 'unknown@example.com' });

    expect(result).toEqual({ success: true });
    expect(resetRepo.issue).not.toHaveBeenCalled();
    expect(emailSender.send).not.toHaveBeenCalled();
  });

  it('returns { success: true } and calls issue + sends email for an existing user', async () => {
    const userId = 'user-uuid-123';
    resetRepo.findUserIdByEmail.mockResolvedValue(userId);

    const result = await useCase.execute({ email: 'user@example.com' });

    expect(result).toEqual({ success: true });
    expect(resetRepo.issue).toHaveBeenCalledTimes(1);
    const [calledUserId, calledHash, calledExpiry] = resetRepo.issue.mock.calls[0] as [
      string,
      string,
      Date,
    ];
    expect(calledUserId).toBe(userId);
    expect(typeof calledHash).toBe('string');
    expect(calledHash).toHaveLength(64); // sha256 hex
    expect(calledExpiry.getTime()).toBeGreaterThan(Date.now());

    expect(emailSender.send).toHaveBeenCalledTimes(1);
    const [to, subject, body] = emailSender.send.mock.calls[0] as [string, string, string];
    expect(to).toBe('user@example.com');
    expect(subject).toBe('Reset your password');
    expect(body).toContain('https://example.com/reset-password');
    expect(body).toContain('token=');
  });

  it('returns { success: true } even if email send throws', async () => {
    resetRepo.findUserIdByEmail.mockResolvedValue('user-uuid-456');
    emailSender.send.mockRejectedValue(new Error('SMTP failure'));

    const result = await useCase.execute({ email: 'user@example.com' });

    expect(result).toEqual({ success: true });
  });
});

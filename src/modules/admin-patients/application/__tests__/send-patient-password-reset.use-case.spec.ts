import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { SendPatientPasswordResetUseCase } from '../send-patient-password-reset.use-case';
import type { AdminPatientRepositoryPort } from '../../domain/ports/admin-patient-repository.port';
import type { PasswordResetRepositoryPort } from '../../../auth/domain/ports/password-reset-repository.port';
import type { EmailSenderPort } from '../../../auth/infrastructure/adapters/email-sender.port';

const ctx = { userId: 'admin-1', role: 'admin', ip: '127.0.0.1' };

const makeRepo = (): jest.Mocked<AdminPatientRepositoryPort> => ({
  listPatients: jest.fn(),
  getPatient: jest.fn(),
  updatePatient: jest.fn(),
  softDeletePatient: jest.fn(),
  findPatientUser: jest.fn(),
});

const makeResetRepo = (): jest.Mocked<PasswordResetRepositoryPort> => ({
  findUserIdByEmail: jest.fn(),
  issue: jest.fn().mockResolvedValue(undefined),
  findValidByEmail: jest.fn(),
  consume: jest.fn(),
  updatePasswordHash: jest.fn().mockResolvedValue(undefined),
});

const makeEmailSender = (): jest.Mocked<EmailSenderPort> => ({
  send: jest.fn().mockResolvedValue(undefined),
});

const makeConfig = (baseUrl = 'https://example.com'): jest.Mocked<ConfigService> =>
  ({ get: jest.fn().mockReturnValue(baseUrl) }) as unknown as jest.Mocked<ConfigService>;

describe('SendPatientPasswordResetUseCase', () => {
  let useCase: SendPatientPasswordResetUseCase;
  let repo: jest.Mocked<AdminPatientRepositoryPort>;
  let resetRepo: jest.Mocked<PasswordResetRepositoryPort>;
  let emailSender: jest.Mocked<EmailSenderPort>;
  let config: jest.Mocked<ConfigService>;

  beforeEach(() => {
    repo = makeRepo();
    resetRepo = makeResetRepo();
    emailSender = makeEmailSender();
    config = makeConfig();
    useCase = new SendPatientPasswordResetUseCase(repo, resetRepo, emailSender, config);
  });

  it('throws NotFoundException when the patient does not exist', async () => {
    repo.findPatientUser.mockResolvedValue(null);
    await expect(useCase.execute(ctx, 'p1')).rejects.toThrow('Patient not found.');
    await expect(useCase.execute(ctx, 'p1')).rejects.toThrow(NotFoundException);
  });

  it('issues a token and emails the reset link', async () => {
    repo.findPatientUser.mockResolvedValue({ userId: 'u9', email: 'patient@example.com' });
    await useCase.execute(ctx, 'p1');
    expect(resetRepo.issue).toHaveBeenCalledWith('u9', expect.any(String), expect.any(Date));
    const [, hash] = resetRepo.issue.mock.calls[0] as [string, string, Date];
    expect(hash).toHaveLength(64); // sha256 hex, never the raw token
    const [to, , link] = emailSender.send.mock.calls[0] as [string, string, string];
    expect(to).toBe('patient@example.com');
    expect(link).toContain('/reset-password?email=patient%40example.com&token=');
  });

  it('returns { success: true }', async () => {
    repo.findPatientUser.mockResolvedValue({ userId: 'u9', email: 'patient@example.com' });
    await expect(useCase.execute(ctx, 'p1')).resolves.toEqual({ success: true });
  });
});

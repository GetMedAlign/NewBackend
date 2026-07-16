import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ReviewApplicationUseCase } from '../review-application.use-case';
import type {
  ApplicationRepositoryPort,
  ApproveResult,
  DenyResult,
  ReviewFailure,
} from '../../domain/ports/application-repository.port';
import type { PasswordResetRepositoryPort } from '../../../auth/domain/ports/password-reset-repository.port';
import type { EmailSenderPort } from '../../../auth/infrastructure/adapters/email-sender.port';

const ctx = { userId: 'admin-1', role: 'superadmin' };

function makeRepo(overrides: Partial<ApplicationRepositoryPort> = {}): ApplicationRepositoryPort {
  return {
    create: jest.fn(),
    list: jest.fn(),
    findById: jest.fn(),
    approve: jest.fn(),
    deny: jest.fn(),
    ...overrides,
  } as unknown as ApplicationRepositoryPort;
}

function makeResetRepo(
  overrides: Partial<PasswordResetRepositoryPort> = {},
): PasswordResetRepositoryPort {
  return {
    findUserIdByEmail: jest.fn(),
    issue: jest.fn().mockResolvedValue(undefined),
    findValidByEmail: jest.fn(),
    consume: jest.fn(),
    updatePasswordHash: jest.fn(),
    ...overrides,
  };
}

function makeEmailSender(
  send: jest.Mock = jest.fn().mockResolvedValue(undefined),
): EmailSenderPort {
  return { send };
}

function makeConfig(): ConfigService {
  return { get: jest.fn().mockReturnValue('https://app.example.com') } as unknown as ConfigService;
}

describe('ReviewApplicationUseCase', () => {
  describe('approve', () => {
    it('provisions, then issues a reset token and welcome email, and returns clinicId', async () => {
      const approveResult: ApproveResult = {
        clinicId: 'clinic-1',
        clinicUserId: 'user-1',
        loginEmail: 'apply@example.com',
      };
      const repo = makeRepo({ approve: jest.fn().mockResolvedValue(approveResult) });
      const resetRepo = makeResetRepo();
      const send = jest.fn().mockResolvedValue(undefined);
      const uc = new ReviewApplicationUseCase(repo, resetRepo, makeEmailSender(send), makeConfig());

      const res = await uc.execute(ctx, 'app-1', { status: 'approved' });

      expect(res).toEqual({ success: true, clinicId: 'clinic-1' });
      expect(repo.approve).toHaveBeenCalledWith(ctx, 'app-1');
      expect(resetRepo.issue).toHaveBeenCalledWith('user-1', expect.any(String), expect.any(Date));
      expect(send).toHaveBeenCalledTimes(1);
      const [to, subject, body] = send.mock.calls[0] as [string, string, string];
      expect(to).toBe('apply@example.com');
      expect(subject).toMatch(/set your password/i);
      expect(body).toContain('https://app.example.com/reset-password?email=');
    });

    it('swallows a welcome-email failure and still returns success', async () => {
      const approveResult: ApproveResult = {
        clinicId: 'clinic-1',
        clinicUserId: 'user-1',
        loginEmail: 'apply@example.com',
      };
      const repo = makeRepo({ approve: jest.fn().mockResolvedValue(approveResult) });
      const send = jest.fn().mockRejectedValue(new Error('smtp down'));
      const uc = new ReviewApplicationUseCase(
        repo,
        makeResetRepo(),
        makeEmailSender(send),
        makeConfig(),
      );

      const res = await uc.execute(ctx, 'app-1', { status: 'approved' });
      expect(res).toEqual({ success: true, clinicId: 'clinic-1' });
    });

    it('maps not_found to 404', async () => {
      const repo = makeRepo({ approve: jest.fn().mockResolvedValue('not_found' as ReviewFailure) });
      const uc = new ReviewApplicationUseCase(
        repo,
        makeResetRepo(),
        makeEmailSender(),
        makeConfig(),
      );
      await expect(uc.execute(ctx, 'app-1', { status: 'approved' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('maps already_reviewed to 409', async () => {
      const repo = makeRepo({
        approve: jest.fn().mockResolvedValue('already_reviewed' as ReviewFailure),
      });
      const uc = new ReviewApplicationUseCase(
        repo,
        makeResetRepo(),
        makeEmailSender(),
        makeConfig(),
      );
      await expect(uc.execute(ctx, 'app-1', { status: 'approved' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('deny', () => {
    it('denies and emails the applicant with the reason, returns success', async () => {
      const denyResult: DenyResult = {
        contactEmail: 'apply@example.com',
        clinicName: 'Horizon',
      };
      const repo = makeRepo({ deny: jest.fn().mockResolvedValue(denyResult) });
      const send = jest.fn().mockResolvedValue(undefined);
      const uc = new ReviewApplicationUseCase(
        repo,
        makeResetRepo(),
        makeEmailSender(send),
        makeConfig(),
      );

      const res = await uc.execute(ctx, 'app-1', {
        status: 'denied',
        denyReason: 'Incomplete NPI',
      });

      expect(res).toEqual({ success: true });
      expect(repo.deny).toHaveBeenCalledWith(ctx, 'app-1', 'Incomplete NPI', 'admin-1');
      const [to, subject, body] = send.mock.calls[0] as [string, string, string];
      expect(to).toBe('apply@example.com');
      expect(subject).toMatch(/application/i);
      expect(body).toContain('Incomplete NPI');
    });

    it('does not issue a reset token when denying', async () => {
      const repo = makeRepo({
        deny: jest.fn().mockResolvedValue({ contactEmail: 'a@b.com', clinicName: 'X' }),
      });
      const resetRepo = makeResetRepo();
      const uc = new ReviewApplicationUseCase(repo, resetRepo, makeEmailSender(), makeConfig());
      await uc.execute(ctx, 'app-1', { status: 'denied' });
      expect(resetRepo.issue).not.toHaveBeenCalled();
    });

    it('swallows a denial-email failure and still returns success', async () => {
      const repo = makeRepo({
        deny: jest.fn().mockResolvedValue({ contactEmail: 'a@b.com', clinicName: 'X' }),
      });
      const send = jest.fn().mockRejectedValue(new Error('smtp down'));
      const uc = new ReviewApplicationUseCase(
        repo,
        makeResetRepo(),
        makeEmailSender(send),
        makeConfig(),
      );
      await expect(uc.execute(ctx, 'app-1', { status: 'denied' })).resolves.toEqual({
        success: true,
      });
    });

    it('maps not_found to 404', async () => {
      const repo = makeRepo({ deny: jest.fn().mockResolvedValue('not_found' as ReviewFailure) });
      const uc = new ReviewApplicationUseCase(
        repo,
        makeResetRepo(),
        makeEmailSender(),
        makeConfig(),
      );
      await expect(uc.execute(ctx, 'app-1', { status: 'denied' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('maps already_reviewed to 409', async () => {
      const repo = makeRepo({
        deny: jest.fn().mockResolvedValue('already_reviewed' as ReviewFailure),
      });
      const uc = new ReviewApplicationUseCase(
        repo,
        makeResetRepo(),
        makeEmailSender(),
        makeConfig(),
      );
      await expect(uc.execute(ctx, 'app-1', { status: 'denied' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
});

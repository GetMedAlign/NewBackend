import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CalendlyCallbackUseCase } from '../calendly-callback.use-case';
import type { CalendlyPort, CalendlyTokens } from '../../domain/ports/calendly.port';
import type { EncryptionPort } from '../../../auth/domain/ports/encryption.port';
import type { SchedulingRepositoryPort } from '../../domain/ports/scheduling-repository.port';

const CLINIC_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const OTHER_CLINIC_ID = 'ffffffff-1111-2222-3333-444444444444';

const TOKENS: CalendlyTokens = {
  accessToken: 'plain-access-token',
  refreshToken: 'plain-refresh-token',
  expiresAt: new Date('2026-09-01T00:00:00.000Z'),
};

const ME = {
  userUri: 'https://api.calendly.com/users/u1',
  orgUri: 'https://api.calendly.com/organizations/o1',
  schedulingUrl: 'https://calendly.com/acme-clinic',
};

function makeCalendly(overrides: Partial<CalendlyPort> = {}): CalendlyPort {
  return {
    buildAuthorizeUrl: jest.fn(),
    exchangeCode: jest.fn().mockResolvedValue(TOKENS),
    refreshToken: jest.fn(),
    getMe: jest.fn().mockResolvedValue(ME),
    createWebhookSubscription: jest
      .fn()
      .mockResolvedValue({ webhookUri: 'https://api.calendly.com/webhook_subscriptions/w1' }),
    deleteWebhookSubscription: jest.fn(),
    ...overrides,
  };
}

// Encrypts by prefixing with "enc:" and decrypts by stripping it, so tests
// can assert on ciphertext shape without a real crypto dependency.
function makeEncryption(overrides: Partial<EncryptionPort> = {}): EncryptionPort {
  return {
    encrypt: jest.fn().mockImplementation((plain: string) => `enc:${plain}`),
    decrypt: jest.fn().mockImplementation((cipher: string) => {
      if (!cipher.startsWith('enc:')) throw new Error('bad ciphertext');
      return cipher.replace(/^enc:/, '');
    }),
    ...overrides,
  };
}

function makeRepo(overrides: Partial<SchedulingRepositoryPort> = {}): SchedulingRepositoryPort {
  return {
    getSchedulingState: jest.fn(),
    setCalendlyConnection: jest.fn().mockResolvedValue(undefined),
    clearScheduling: jest.fn(),
    getWebhookVerificationState: jest.fn(),
    ...overrides,
  };
}

/** Builds a valid encrypted state value for CLINIC_ID via the fake encryption scheme. */
function validState(clinicId: string = CLINIC_ID, nonce = 'nonce-123'): string {
  return `enc:${clinicId}:${nonce}`;
}

describe('CalendlyCallbackUseCase', () => {
  it('happy path: exchanges code, fetches me, creates a webhook, and persists encrypted values', async () => {
    const calendly = makeCalendly();
    const encryption = makeEncryption();
    const repo = makeRepo();
    const useCase = new CalendlyCallbackUseCase(calendly, encryption, repo);

    const result = await useCase.execute(CLINIC_ID, 'auth-code', validState());

    expect(calendly.exchangeCode).toHaveBeenCalledWith('auth-code');
    expect(calendly.getMe).toHaveBeenCalledWith(TOKENS.accessToken);
    expect(calendly.createWebhookSubscription).toHaveBeenCalledWith(
      TOKENS.accessToken,
      ME.orgUri,
      expect.any(String),
      CLINIC_ID,
    );

    const [, connectionInput] = (repo.setCalendlyConnection as jest.Mock).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(repo.setCalendlyConnection).toHaveBeenCalledWith(
      CLINIC_ID,
      expect.objectContaining({
        userUri: ME.userUri,
        orgUri: ME.orgUri,
        schedulingUrl: ME.schedulingUrl,
        accessTokenEncrypted: 'enc:plain-access-token',
        refreshTokenEncrypted: 'enc:plain-refresh-token',
        tokenExpiresAt: TOKENS.expiresAt,
        webhookUri: 'https://api.calendly.com/webhook_subscriptions/w1',
      }),
    );

    // Signing key persisted encrypted and never in plaintext anywhere in the call.
    const signingKeyEncrypted = connectionInput['signingKeyEncrypted'] as string;
    expect(signingKeyEncrypted.startsWith('enc:')).toBe(true);
    const [, , signingKeyArg] = (calendly.createWebhookSubscription as jest.Mock).mock.calls[0] as [
      string,
      string,
      string,
      string,
    ];
    expect(signingKeyEncrypted).toBe(`enc:${signingKeyArg}`);

    expect(result).toEqual({ connected: true, schedulingUrl: ME.schedulingUrl });
  });

  it('rejects when the decrypted state clinicId does not match the caller', async () => {
    const calendly = makeCalendly();
    const encryption = makeEncryption();
    const repo = makeRepo();
    const useCase = new CalendlyCallbackUseCase(calendly, encryption, repo);

    await expect(
      useCase.execute(CLINIC_ID, 'auth-code', validState(OTHER_CLINIC_ID)),
    ).rejects.toThrow(ForbiddenException);

    expect(calendly.exchangeCode).not.toHaveBeenCalled();
    expect(repo.setCalendlyConnection).not.toHaveBeenCalled();
  });

  it('rejects with BadRequestException when state cannot be decrypted', async () => {
    const calendly = makeCalendly();
    const encryption = makeEncryption();
    const repo = makeRepo();
    const useCase = new CalendlyCallbackUseCase(calendly, encryption, repo);

    await expect(useCase.execute(CLINIC_ID, 'auth-code', 'not-valid-ciphertext')).rejects.toThrow(
      BadRequestException,
    );

    expect(calendly.exchangeCode).not.toHaveBeenCalled();
    expect(repo.setCalendlyConnection).not.toHaveBeenCalled();
  });

  it('does not persist a partial connection when a Calendly call fails midway', async () => {
    const calendly = makeCalendly({
      createWebhookSubscription: jest.fn().mockRejectedValue(new Error('Calendly outage')),
    });
    const encryption = makeEncryption();
    const repo = makeRepo();
    const useCase = new CalendlyCallbackUseCase(calendly, encryption, repo);

    await expect(useCase.execute(CLINIC_ID, 'auth-code', validState())).rejects.toThrow(
      'Calendly outage',
    );

    expect(repo.setCalendlyConnection).not.toHaveBeenCalled();
  });
});

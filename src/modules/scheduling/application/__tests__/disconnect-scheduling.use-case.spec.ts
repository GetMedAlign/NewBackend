import { DisconnectSchedulingUseCase } from '../disconnect-scheduling.use-case';
import type { CalendlyPort } from '../../domain/ports/calendly.port';
import type { EncryptionPort } from '../../../auth/domain/ports/encryption.port';
import type { SchedulingRepositoryPort } from '../../domain/ports/scheduling-repository.port';

const CLINIC_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const WEBHOOK_URI = 'https://api.calendly.com/webhook_subscriptions/w1';

function makeCalendly(overrides: Partial<CalendlyPort> = {}): CalendlyPort {
  return {
    buildAuthorizeUrl: jest.fn(),
    exchangeCode: jest.fn(),
    refreshToken: jest.fn(),
    getMe: jest.fn(),
    createWebhookSubscription: jest.fn(),
    deleteWebhookSubscription: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeEncryption(overrides: Partial<EncryptionPort> = {}): EncryptionPort {
  return {
    encrypt: jest.fn().mockImplementation((plain: string) => `enc:${plain}`),
    decrypt: jest.fn().mockImplementation((cipher: string) => cipher.replace(/^enc:/, '')),
    ...overrides,
  };
}

function makeRepo(overrides: Partial<SchedulingRepositoryPort> = {}): SchedulingRepositoryPort {
  return {
    getSchedulingState: jest.fn().mockResolvedValue({
      provider: 'calendly',
      schedulingUrl: 'https://calendly.com/acme-clinic',
      accessTokenEncrypted: 'enc:plain-access-token',
      webhookUri: WEBHOOK_URI,
    }),
    setCalendlyConnection: jest.fn(),
    clearScheduling: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('DisconnectSchedulingUseCase', () => {
  it('decrypts the access token, deletes the remote webhook, and clears local state', async () => {
    const calendly = makeCalendly();
    const encryption = makeEncryption();
    const repo = makeRepo();
    const useCase = new DisconnectSchedulingUseCase(calendly, encryption, repo);

    const result = await useCase.execute(CLINIC_ID);

    expect(encryption.decrypt).toHaveBeenCalledWith('enc:plain-access-token');
    expect(calendly.deleteWebhookSubscription).toHaveBeenCalledWith(
      'plain-access-token',
      WEBHOOK_URI,
    );
    expect(repo.clearScheduling).toHaveBeenCalledWith(CLINIC_ID);
    expect(result).toEqual({ connected: false });
  });

  it('still clears local state when the remote webhook delete fails (best-effort)', async () => {
    const calendly = makeCalendly({
      deleteWebhookSubscription: jest.fn().mockRejectedValue(new Error('Calendly 404')),
    });
    const encryption = makeEncryption();
    const repo = makeRepo();
    const useCase = new DisconnectSchedulingUseCase(calendly, encryption, repo);

    const result = await useCase.execute(CLINIC_ID);

    expect(calendly.deleteWebhookSubscription).toHaveBeenCalled();
    expect(repo.clearScheduling).toHaveBeenCalledWith(CLINIC_ID);
    expect(result).toEqual({ connected: false });
  });

  it('skips the remote delete and just clears when already disconnected', async () => {
    const calendly = makeCalendly();
    const encryption = makeEncryption();
    const repo = makeRepo({
      getSchedulingState: jest.fn().mockResolvedValue({
        provider: 'none',
        schedulingUrl: null,
        accessTokenEncrypted: null,
        webhookUri: null,
      }),
    });
    const useCase = new DisconnectSchedulingUseCase(calendly, encryption, repo);

    const result = await useCase.execute(CLINIC_ID);

    expect(calendly.deleteWebhookSubscription).not.toHaveBeenCalled();
    expect(repo.clearScheduling).toHaveBeenCalledWith(CLINIC_ID);
    expect(result).toEqual({ connected: false });
  });
});

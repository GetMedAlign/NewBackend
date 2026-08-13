import { GetSchedulingStatusUseCase } from '../get-scheduling-status.use-case';
import type { SchedulingRepositoryPort } from '../../domain/ports/scheduling-repository.port';

const CLINIC_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function makeRepo(overrides: Partial<SchedulingRepositoryPort> = {}): SchedulingRepositoryPort {
  return {
    getSchedulingState: jest.fn().mockResolvedValue({
      provider: 'none',
      schedulingUrl: null,
      accessTokenEncrypted: null,
      webhookUri: null,
    }),
    setCalendlyConnection: jest.fn().mockResolvedValue(undefined),
    clearScheduling: jest.fn().mockResolvedValue(undefined),
    getWebhookVerificationState: jest.fn(),
    ...overrides,
  };
}

describe('GetSchedulingStatusUseCase', () => {
  it('returns connected: false and provider: none when disconnected', async () => {
    const repo = makeRepo();
    const useCase = new GetSchedulingStatusUseCase(repo);

    const result = await useCase.execute(CLINIC_ID);

    expect(result).toEqual({ provider: 'none', connected: false, schedulingUrl: null });
  });

  it('returns connected: true with the scheduling URL when a provider is connected', async () => {
    const repo = makeRepo({
      getSchedulingState: jest.fn().mockResolvedValue({
        provider: 'calendly',
        schedulingUrl: 'https://calendly.com/acme-clinic',
        accessTokenEncrypted: 'enc:access-token',
        webhookUri: 'https://api.calendly.com/webhook_subscriptions/abc',
      }),
    });
    const useCase = new GetSchedulingStatusUseCase(repo);

    const result = await useCase.execute(CLINIC_ID);

    expect(result).toEqual({
      provider: 'calendly',
      connected: true,
      schedulingUrl: 'https://calendly.com/acme-clinic',
    });
  });

  it('never includes ciphertext or webhook internals in the returned shape', async () => {
    const repo = makeRepo({
      getSchedulingState: jest.fn().mockResolvedValue({
        provider: 'calendly',
        schedulingUrl: 'https://calendly.com/acme-clinic',
        accessTokenEncrypted: 'enc:access-token',
        webhookUri: 'https://api.calendly.com/webhook_subscriptions/abc',
      }),
    });
    const useCase = new GetSchedulingStatusUseCase(repo);

    const result = await useCase.execute(CLINIC_ID);

    expect(Object.keys(result).sort()).toEqual(['connected', 'provider', 'schedulingUrl']);
    expect(JSON.stringify(result)).not.toContain('enc:');
    expect(JSON.stringify(result)).not.toContain('webhook_subscriptions');
  });
});

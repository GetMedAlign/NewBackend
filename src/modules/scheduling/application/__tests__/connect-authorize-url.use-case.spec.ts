import { ConnectAuthorizeUrlUseCase } from '../connect-authorize-url.use-case';
import type { CalendlyPort } from '../../domain/ports/calendly.port';
import type { EncryptionPort } from '../../../auth/domain/ports/encryption.port';

const CLINIC_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function makeCalendly(overrides: Partial<CalendlyPort> = {}): CalendlyPort {
  return {
    buildAuthorizeUrl: jest
      .fn()
      .mockImplementation(
        (state: string) => `https://auth.calendly.com/oauth/authorize?state=${state}`,
      ),
    exchangeCode: jest.fn(),
    refreshToken: jest.fn(),
    getMe: jest.fn(),
    createWebhookSubscription: jest.fn(),
    deleteWebhookSubscription: jest.fn(),
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

describe('ConnectAuthorizeUrlUseCase', () => {
  it('encrypts clinicId:nonce as state and passes it to CalendlyPort.buildAuthorizeUrl', () => {
    const calendly = makeCalendly();
    const encryption = makeEncryption();
    const useCase = new ConnectAuthorizeUrlUseCase(calendly, encryption);

    const result = useCase.execute(CLINIC_ID);

    expect(encryption.encrypt).toHaveBeenCalledTimes(1);
    const [plaintext] = (encryption.encrypt as jest.Mock).mock.calls[0] as [string];
    expect(plaintext.startsWith(`${CLINIC_ID}:`)).toBe(true);

    expect(calendly.buildAuthorizeUrl).toHaveBeenCalledWith(`enc:${plaintext}`);
    expect(result.authorizeUrl).toBe(
      `https://auth.calendly.com/oauth/authorize?state=enc:${plaintext}`,
    );
  });

  it('generates a different nonce (and therefore state) on each call', () => {
    const calendly = makeCalendly();
    const encryption = makeEncryption();
    const useCase = new ConnectAuthorizeUrlUseCase(calendly, encryption);

    useCase.execute(CLINIC_ID);
    useCase.execute(CLINIC_ID);

    const calls = (encryption.encrypt as jest.Mock).mock.calls as [string][];
    expect(calls[0]![0]).not.toBe(calls[1]![0]);
  });
});

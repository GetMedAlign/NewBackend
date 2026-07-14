import { BadRequestException } from '@nestjs/common';
import { ListWebhookDeliveriesUseCase } from '../list-webhook-deliveries.use-case';
import { RotateWebhookSecretUseCase } from '../rotate-webhook-secret.use-case';
import { TestWebhookUseCase } from '../test-webhook.use-case';
import type {
  ClinicWebhookRepositoryPort,
  WebhookDeliveryDto,
} from '../../domain/ports/clinic-webhook-repository.port';
import type { EncryptionPort } from '../../../auth/domain/ports/encryption.port';
import type {
  WebhookSenderPort,
  WebhookSendResult,
} from '../../../leads/domain/ports/webhook-sender.port';

const CLINIC_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function makeRepo(
  overrides: Partial<ClinicWebhookRepositoryPort> = {},
): ClinicWebhookRepositoryPort {
  return {
    listWebhookDeliveries: jest.fn().mockResolvedValue([]),
    rotateWebhookSecret: jest.fn().mockResolvedValue(undefined),
    getWebhookSecretCiphertext: jest.fn().mockResolvedValue(null),
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

function makeWebhookSender(
  result: WebhookSendResult = { ok: true, status: 200 },
): WebhookSenderPort {
  return {
    send: jest.fn().mockResolvedValue(result),
  };
}

// ---------------------------------------------------------------------------
// RotateWebhookSecretUseCase
// ---------------------------------------------------------------------------

describe('RotateWebhookSecretUseCase', () => {
  it('generates a 64-char lowercase hex secret', async () => {
    const repo = makeRepo();
    const encryption = makeEncryption();
    const useCase = new RotateWebhookSecretUseCase(repo, encryption);

    const result = await useCase.execute(CLINIC_ID);

    expect(typeof result.webhookSecret).toBe('string');
    expect(result.webhookSecret).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(result.webhookSecret)).toBe(true);
  });

  it('calls encryption.encrypt with the plaintext secret', async () => {
    const repo = makeRepo();
    const encryption = makeEncryption();
    const useCase = new RotateWebhookSecretUseCase(repo, encryption);

    const result = await useCase.execute(CLINIC_ID);

    expect(encryption.encrypt).toHaveBeenCalledWith(result.webhookSecret);
  });

  it('calls repo.rotateWebhookSecret with clinicId and the ciphertext', async () => {
    const repo = makeRepo();
    const encryption = makeEncryption();
    const useCase = new RotateWebhookSecretUseCase(repo, encryption);

    const result = await useCase.execute(CLINIC_ID);
    const expectedCiphertext = `enc:${result.webhookSecret}`;

    expect(repo.rotateWebhookSecret).toHaveBeenCalledWith(CLINIC_ID, expectedCiphertext);
  });

  it('returns { webhookSecret: <plaintext> } not the ciphertext', async () => {
    const repo = makeRepo();
    const encryption = makeEncryption();
    const useCase = new RotateWebhookSecretUseCase(repo, encryption);

    const result = await useCase.execute(CLINIC_ID);

    // The returned value must be the plaintext (hex), not the encrypted form
    expect(result.webhookSecret).not.toContain('enc:');
    expect(/^[0-9a-f]{64}$/.test(result.webhookSecret)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ListWebhookDeliveriesUseCase
// ---------------------------------------------------------------------------

describe('ListWebhookDeliveriesUseCase', () => {
  it('calls repo.listWebhookDeliveries with clinicId and returns the array', async () => {
    const delivery: WebhookDeliveryDto = {
      lead_id: 'lead_abc123',
      attempted_at: new Date().toISOString(),
      status: 'success',
      http_status_code: 200,
      error_message: null,
    };
    const repo = makeRepo({ listWebhookDeliveries: jest.fn().mockResolvedValue([delivery]) });
    const useCase = new ListWebhookDeliveriesUseCase(repo);

    const result = await useCase.execute(CLINIC_ID);

    expect(repo.listWebhookDeliveries).toHaveBeenCalledWith(CLINIC_ID);
    expect(result).toEqual([delivery]);
  });

  it('handles empty array', async () => {
    const repo = makeRepo({ listWebhookDeliveries: jest.fn().mockResolvedValue([]) });
    const useCase = new ListWebhookDeliveriesUseCase(repo);

    const result = await useCase.execute(CLINIC_ID);

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// TestWebhookUseCase
// ---------------------------------------------------------------------------

describe('TestWebhookUseCase', () => {
  it('throws BadRequestException for a non-HTTPS (http://) URL', async () => {
    const repo = makeRepo({
      getWebhookSecretCiphertext: jest.fn().mockResolvedValue('enc:secret'),
    });
    const encryption = makeEncryption();
    const sender = makeWebhookSender();
    const useCase = new TestWebhookUseCase(repo, encryption, sender);

    await expect(useCase.execute(CLINIC_ID, 'http://not-https.com/hook')).rejects.toThrow(
      BadRequestException,
    );
    await expect(useCase.execute(CLINIC_ID, 'http://not-https.com/hook')).rejects.toThrow(
      'webhookUrl must be an absolute HTTPS URL',
    );
  });

  it('throws BadRequestException for an invalid URL', async () => {
    const repo = makeRepo();
    const encryption = makeEncryption();
    const sender = makeWebhookSender();
    const useCase = new TestWebhookUseCase(repo, encryption, sender);

    await expect(useCase.execute(CLINIC_ID, 'not-a-url')).rejects.toThrow(BadRequestException);
    await expect(useCase.execute(CLINIC_ID, 'not-a-url')).rejects.toThrow(
      'webhookUrl must be an absolute HTTPS URL',
    );
  });

  it('throws BadRequestException when no webhook secret is configured', async () => {
    const repo = makeRepo({ getWebhookSecretCiphertext: jest.fn().mockResolvedValue(null) });
    const encryption = makeEncryption();
    const sender = makeWebhookSender();
    const useCase = new TestWebhookUseCase(repo, encryption, sender);

    await expect(useCase.execute(CLINIC_ID, 'https://example.com/hook')).rejects.toThrow(
      BadRequestException,
    );
    await expect(useCase.execute(CLINIC_ID, 'https://example.com/hook')).rejects.toThrow(
      'Configure a webhook secret first.',
    );
  });

  it('maps a failed sender result to a failed WebhookDeliveryDto and does NOT persist', async () => {
    const repo = makeRepo({
      getWebhookSecretCiphertext: jest.fn().mockResolvedValue('enc:mysecret'),
    });
    const encryption = makeEncryption();
    const sender = makeWebhookSender({ ok: false, status: 500, error: 'timeout' });
    const useCase = new TestWebhookUseCase(repo, encryption, sender);

    const result = await useCase.execute(CLINIC_ID, 'https://example.com/hook');

    expect(result.status).toBe('failed');
    expect(result.http_status_code).toBe(500);
    expect(result.error_message).toBe('timeout');
    // Must NOT have called any write method
    expect(repo.rotateWebhookSecret).not.toHaveBeenCalled();
  });

  it('maps a successful sender result to a success WebhookDeliveryDto', async () => {
    const repo = makeRepo({
      getWebhookSecretCiphertext: jest.fn().mockResolvedValue('enc:mysecret'),
    });
    const encryption = makeEncryption();
    const sender = makeWebhookSender({ ok: true, status: 200 });
    const useCase = new TestWebhookUseCase(repo, encryption, sender);

    const result = await useCase.execute(CLINIC_ID, 'https://example.com/hook');

    expect(result.status).toBe('success');
    expect(result.http_status_code).toBe(200);
    expect(result.error_message).toBeNull();
  });

  it('sends a payload with event_type: lead.created and all required fields', async () => {
    const repo = makeRepo({
      getWebhookSecretCiphertext: jest.fn().mockResolvedValue('enc:mysecret'),
    });
    const encryption = makeEncryption();
    const sender = makeWebhookSender({ ok: true, status: 200 });
    const useCase = new TestWebhookUseCase(repo, encryption, sender);

    await useCase.execute(CLINIC_ID, 'https://example.com/hook');

    expect(sender.send).toHaveBeenCalledTimes(1);
    const [sentUrl, sentPayload, sentSecret] = (sender.send as jest.Mock).mock.calls[0] as [
      string,
      Record<string, unknown>,
      string,
    ];
    expect(sentUrl).toBe('https://example.com/hook');
    expect((sentPayload as Record<string, unknown>)['event_type']).toBe('lead.created');
    expect((sentPayload as Record<string, unknown>)['patient_first_name']).toBe('Test');
    expect((sentPayload as Record<string, unknown>)['patient_email']).toBe('test@getmedalign.com');
    expect((sentPayload as Record<string, unknown>)['lead_source']).toBe('medalign');
    expect(sentSecret).toBe('mysecret');
  });

  it('returns a lead_id starting with test_', async () => {
    const repo = makeRepo({
      getWebhookSecretCiphertext: jest.fn().mockResolvedValue('enc:mysecret'),
    });
    const encryption = makeEncryption();
    const sender = makeWebhookSender({ ok: true, status: 200 });
    const useCase = new TestWebhookUseCase(repo, encryption, sender);

    const result = await useCase.execute(CLINIC_ID, 'https://example.com/hook');

    expect(result.lead_id.startsWith('test_')).toBe(true);
  });

  it('uses error_message fallback when sender returns no error string', async () => {
    const repo = makeRepo({
      getWebhookSecretCiphertext: jest.fn().mockResolvedValue('enc:mysecret'),
    });
    const encryption = makeEncryption();
    const sender = makeWebhookSender({ ok: false, status: 503 });
    const useCase = new TestWebhookUseCase(repo, encryption, sender);

    const result = await useCase.execute(CLINIC_ID, 'https://example.com/hook');

    expect(result.status).toBe('failed');
    expect(result.error_message).toBe('Endpoint returned HTTP 503');
  });
});

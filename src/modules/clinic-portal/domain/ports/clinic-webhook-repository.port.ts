export type WebhookDeliveryDto = {
  lead_id: string;
  attempted_at: string;
  status: string;
  http_status_code: number | null;
  error_message: string | null;
};

export const CLINIC_WEBHOOK_REPOSITORY = Symbol('ClinicWebhookRepositoryPort');

export interface ClinicWebhookRepositoryPort {
  listWebhookDeliveries(clinicId: string): Promise<WebhookDeliveryDto[]>;
  rotateWebhookSecret(clinicId: string, encryptedSecret: string): Promise<void>;
  getWebhookSecretCiphertext(clinicId: string): Promise<string | null>;
}

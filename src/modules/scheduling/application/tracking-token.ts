import type { EncryptionPort } from '../../auth/domain/ports/encryption.port';

export type DecodedTrackingToken = {
  leadId: string;
  clinicId: string;
};

/**
 * Decodes the Calendly `payload.tracking.utm_content` value set by the
 * booking embed (Slice 4): `EncryptionPort.encrypt(\`${leadId}:${clinicId}\`)`.
 * Splits the decrypted plaintext on the first `:` into `{ leadId, clinicId }`.
 *
 * Returns null on any failure — missing value, decrypt error, or a
 * plaintext that isn't `<leadId>:<clinicId>` — never throws. A malformed or
 * tampered token must fall back to email matching (see
 * `HandleCalendlyWebhookUseCase`), not fail the webhook.
 */
export function decodeTrackingToken(
  encryption: EncryptionPort,
  utmContent: string | null | undefined,
): DecodedTrackingToken | null {
  if (!utmContent) return null;

  let plaintext: string;
  try {
    plaintext = encryption.decrypt(utmContent);
  } catch {
    return null;
  }

  const separatorIndex = plaintext.indexOf(':');
  if (separatorIndex === -1) return null;

  const leadId = plaintext.slice(0, separatorIndex);
  const clinicId = plaintext.slice(separatorIndex + 1);
  if (!leadId || !clinicId) return null;

  return { leadId, clinicId };
}

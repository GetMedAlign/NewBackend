import type { ConfigService } from '@nestjs/config';
import type { EmailConfirmTokenService } from './email-confirm-token.service';

/** Builds the frontend email-confirmation link for the given address. */
export function buildConfirmationLink(
  config: ConfigService,
  tokens: EmailConfirmTokenService,
  email: string,
): string {
  const baseUrl = config.get<string>('APP_BASE_URL');
  const token = tokens.issue(email);
  return `${baseUrl}/confirm-email?email=${encodeURIComponent(email)}&token=${token}`;
}

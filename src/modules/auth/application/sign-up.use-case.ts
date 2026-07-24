import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Email } from '../domain/value-objects/email';
import { PasswordHasherPort, PASSWORD_HASHER } from '../domain/ports/password-hasher.port';
import { UserRepositoryPort, USER_REPOSITORY } from '../domain/ports/user-repository.port';
import { AuditPort, AUDIT } from '../domain/ports/audit.port';
import { EMAIL_SENDER } from '../infrastructure/adapters/email-sender.port';
import type { EmailSenderPort } from '../infrastructure/adapters/email-sender.port';
import { EmailConfirmTokenService } from '../domain/email-confirm-token.service';
import { buildConfirmationLink } from '../domain/confirmation-email';

export interface SignUpInput {
  email: string;
  password: string;
  ip?: string;
  name?: string;
  dob?: string;
}

export interface SignUpOutput {
  userId: string;
}

@Injectable()
export class SignUpUseCase {
  constructor(
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasherPort,
    @Inject(USER_REPOSITORY) private readonly repo: UserRepositoryPort,
    @Inject(AUDIT) private readonly audit: AuditPort,
    @Inject(EMAIL_SENDER) private readonly emailSender: EmailSenderPort,
    private readonly confirmTokens: EmailConfirmTokenService,
    private readonly config: ConfigService,
  ) {}

  async execute(input: SignUpInput): Promise<SignUpOutput> {
    const email = Email.create(input.email);
    const passwordHash = await this.hasher.hash(input.password);

    const userId = await this.repo.create(email.toString(), passwordHash, input.name, input.dob);

    await this.audit.record({
      actorUserId: userId,
      actorRole: 'patient',
      ip: input.ip ?? null,
      actionType: 'signup',
      affectedRecord: userId,
    });

    // Send the confirmation email best-effort: a send failure must not fail
    // signup (the user can request a resend). The account starts unconfirmed.
    try {
      const link = buildConfirmationLink(this.config, this.confirmTokens, email.toString());
      await this.emailSender.send(email.toString(), 'Confirm your email', link);
    } catch {
      // swallow: signup succeeded; confirmation can be resent.
    }

    return { userId };
  }
}

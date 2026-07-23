import { Injectable, Inject } from '@nestjs/common';
import { Email } from '../domain/value-objects/email';
import { PasswordHasherPort, PASSWORD_HASHER } from '../domain/ports/password-hasher.port';
import { UserRepositoryPort, USER_REPOSITORY } from '../domain/ports/user-repository.port';
import { AuditPort, AUDIT } from '../domain/ports/audit.port';

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

    return { userId };
  }
}

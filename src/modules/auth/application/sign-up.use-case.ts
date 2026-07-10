import { Injectable, Inject } from '@nestjs/common';
import { Email } from '../domain/value-objects/email';
import { EmailAlreadyExistsError } from '../domain/errors/email-already-exists.error';
import {
  PasswordHasherPort,
  PASSWORD_HASHER,
} from '../domain/ports/password-hasher.port';
import {
  UserRepositoryPort,
  USER_REPOSITORY,
} from '../domain/ports/user-repository.port';
import { AuditPort, AUDIT } from '../domain/ports/audit.port';

export interface SignUpInput {
  email: string;
  password: string;
  ip?: string;
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

    let userId: string;
    try {
      userId = await this.repo.create(email.toString(), passwordHash);
    } catch (err) {
      if (err instanceof EmailAlreadyExistsError) throw err;
      throw err;
    }

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

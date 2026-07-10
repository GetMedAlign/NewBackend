import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';

import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { CryptoModule } from '../../infrastructure/crypto/crypto.module';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

import { PASSWORD_HASHER } from './domain/ports/password-hasher.port';
import { TOKEN_SERVICE } from './domain/ports/token-service.port';
import { TWO_FACTOR } from './domain/ports/two-factor.port';
import { USER_REPOSITORY } from './domain/ports/user-repository.port';
import { AUDIT } from './domain/ports/audit.port';
import { EMAIL_SENDER } from './infrastructure/adapters/email-sender.port';

import { Argon2PasswordHasher } from './infrastructure/adapters/argon2-password-hasher';
import { JwtTokenService } from './infrastructure/adapters/jwt-token.service';
import { EmailTwoFactor } from './infrastructure/adapters/email-two-factor';
import { SendGridEmailSender } from './infrastructure/adapters/sendgrid-email-sender';
import { PrismaUserRepository } from './infrastructure/persistence/prisma-user.repository';
import { PostgresAuditAdapter } from './infrastructure/adapters/postgres-audit.adapter';
import type { Env } from '../../infrastructure/config/env.schema';
import type { PasswordHasherPort } from './domain/ports/password-hasher.port';
import type { EmailSenderPort } from './infrastructure/adapters/email-sender.port';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    CryptoModule,
    JwtModule.register({}),
  ],
  providers: [
    // Argon2PasswordHasher is used both as a concrete class and via its port token
    Argon2PasswordHasher,
    {
      provide: PASSWORD_HASHER,
      useExisting: Argon2PasswordHasher,
    },

    // JwtTokenService wired with config values
    {
      provide: TOKEN_SERVICE,
      inject: [JwtService, ConfigService],
      useFactory: (jwtService: JwtService, config: ConfigService<Env, true>) =>
        new JwtTokenService(
          jwtService,
          config.getOrThrow<string>('JWT_SECRET'),
          config.getOrThrow<number>('JWT_EXPIRY_MINUTES'),
        ),
    },

    // EmailSenderPort → SendGridEmailSender
    {
      provide: EMAIL_SENDER,
      useClass: SendGridEmailSender,
    },

    // TwoFactorPort → EmailTwoFactor
    {
      provide: TWO_FACTOR,
      inject: [PrismaService, PASSWORD_HASHER, EMAIL_SENDER],
      useFactory: (
        prisma: PrismaService,
        hasher: PasswordHasherPort,
        emailSender: EmailSenderPort,
      ) => new EmailTwoFactor(prisma, hasher, emailSender),
    },

    // UserRepositoryPort → PrismaUserRepository
    {
      provide: USER_REPOSITORY,
      useClass: PrismaUserRepository,
    },

    // AuditPort → PostgresAuditAdapter
    {
      provide: AUDIT,
      useClass: PostgresAuditAdapter,
    },
  ],
  exports: [
    PASSWORD_HASHER,
    TOKEN_SERVICE,
    TWO_FACTOR,
    USER_REPOSITORY,
    AUDIT,
    EMAIL_SENDER,
  ],
})
export class AuthModule {}

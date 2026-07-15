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
import { PASSWORD_RESET_REPOSITORY } from './domain/ports/password-reset-repository.port';

import { Argon2PasswordHasher } from './infrastructure/adapters/argon2-password-hasher';
import { JwtTokenService } from './infrastructure/adapters/jwt-token.service';
import { EmailTwoFactor } from './infrastructure/adapters/email-two-factor';
import { SendGridEmailSender } from './infrastructure/adapters/sendgrid-email-sender';
import { LoggingEmailSender } from './infrastructure/adapters/logging-email-sender';
import { PrismaUserRepository } from './infrastructure/persistence/prisma-user.repository';
import { PrismaPasswordResetRepository } from './infrastructure/persistence/prisma-password-reset.repository';
import { PostgresAuditAdapter } from './infrastructure/adapters/postgres-audit.adapter';
import type { Env } from '../../infrastructure/config/env.schema';
import type { PasswordHasherPort } from './domain/ports/password-hasher.port';
import type { EmailSenderPort } from './infrastructure/adapters/email-sender.port';

import { AuthController } from './infrastructure/http/auth.controller';
import { SignUpUseCase } from './application/sign-up.use-case';
import { SignInUseCase } from './application/sign-in.use-case';
import { VerifyTwoFactorUseCase } from './application/verify-two-factor.use-case';
import { ResendTwoFactorUseCase } from './application/resend-two-factor.use-case';
import { GetMeUseCase } from './application/get-me.use-case';
import { SignOutUseCase } from './application/sign-out.use-case';
import { ForgotPasswordUseCase } from './application/forgot-password.use-case';
import { ResetPasswordUseCase } from './application/reset-password.use-case';

@Module({
  imports: [ConfigModule, PrismaModule, CryptoModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    // Application use cases
    SignUpUseCase,
    SignInUseCase,
    VerifyTwoFactorUseCase,
    ResendTwoFactorUseCase,
    GetMeUseCase,
    SignOutUseCase,
    ForgotPasswordUseCase,
    ResetPasswordUseCase,

    // Concrete email sender classes — both registered so the factory can pick
    SendGridEmailSender,
    LoggingEmailSender,

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

    // EmailSenderPort — LoggingEmailSender in dev/test, SendGridEmailSender in production
    {
      provide: EMAIL_SENDER,
      inject: [ConfigService, SendGridEmailSender, LoggingEmailSender],
      useFactory: (
        config: ConfigService<Env, true>,
        sendGrid: SendGridEmailSender,
        logging: LoggingEmailSender,
      ): EmailSenderPort => {
        const env = config.get<string>('NODE_ENV');
        return env === 'development' || env === 'test' ? logging : sendGrid;
      },
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

    // PasswordResetRepositoryPort → PrismaPasswordResetRepository
    PrismaPasswordResetRepository,
    {
      provide: PASSWORD_RESET_REPOSITORY,
      useClass: PrismaPasswordResetRepository,
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
    PASSWORD_RESET_REPOSITORY,
  ],
})
export class AuthModule {}

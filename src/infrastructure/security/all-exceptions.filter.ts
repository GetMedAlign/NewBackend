import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

import { InvalidCredentialsError } from '../../modules/auth/domain/errors/invalid-credentials.error';
import { AccountLockedError } from '../../modules/auth/domain/errors/account-locked.error';
import { InvalidTwoFactorCodeError } from '../../modules/auth/domain/errors/invalid-two-factor-code.error';
import { EmailAlreadyExistsError } from '../../modules/auth/domain/errors/email-already-exists.error';
import { TwoFactorRequiredError } from '../../modules/auth/domain/errors/two-factor-required.error';
import { InvalidEmailError } from '../../modules/auth/domain/value-objects/email';
import { ConsentRequiredError } from '../../modules/assessments/domain/errors/consent-required.error';
import { InvalidConsentVersionError } from '../../modules/assessments/domain/errors/invalid-consent-version.error';
import { RecommendationNotFoundError } from '../../modules/recommendations/domain/errors/recommendation-not-found.error';
import { ClinicNotFoundError } from '../../modules/leads/domain/errors/clinic-not-found.error';
import { PatientNotFoundError } from '../../modules/patients/domain/errors/patient-not-found.error';

/** HTTP 423 Locked — not present in this NestJS HttpStatus enum. */
const HTTP_LOCKED = 423;

interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
  };
}

/**
 * Global exception filter. Maps typed domain errors and framework exceptions
 * to a uniform JSON envelope without leaking stack traces or internal detail.
 * Auth-related messages are intentionally generic to avoid enumeration.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, code, message } = this.map(exception);

    const body: ErrorEnvelope = { error: { code, message } };
    response.status(status).json(body);
  }

  private map(exception: unknown): {
    status: number;
    code: string;
    message: string;
  } {
    if (exception instanceof InvalidCredentialsError) {
      return {
        status: HttpStatus.UNAUTHORIZED,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      };
    }

    if (exception instanceof InvalidTwoFactorCodeError) {
      return {
        status: HttpStatus.UNAUTHORIZED,
        code: 'INVALID_TWO_FACTOR_CODE',
        message: 'Invalid or expired verification code',
      };
    }

    if (exception instanceof AccountLockedError) {
      return {
        status: HTTP_LOCKED,
        code: 'ACCOUNT_LOCKED',
        message: 'Account is temporarily locked. Please try again later.',
      };
    }

    if (exception instanceof EmailAlreadyExistsError) {
      return {
        status: HttpStatus.CONFLICT,
        code: 'EMAIL_ALREADY_EXISTS',
        message: 'Email is already registered',
      };
    }

    if (exception instanceof TwoFactorRequiredError) {
      return {
        status: HttpStatus.UNAUTHORIZED,
        code: 'TWO_FACTOR_REQUIRED',
        message: 'Two-factor authentication required',
      };
    }

    if (exception instanceof InvalidEmailError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
      };
    }

    if (exception instanceof RecommendationNotFoundError) {
      return {
        status: HttpStatus.NOT_FOUND,
        code: 'NOT_FOUND',
        message: 'Assessment not found',
      };
    }

    if (exception instanceof ClinicNotFoundError) {
      return {
        status: HttpStatus.NOT_FOUND,
        code: 'NOT_FOUND',
        message: 'Clinic not found',
      };
    }

    if (exception instanceof PatientNotFoundError) {
      return {
        status: HttpStatus.NOT_FOUND,
        code: 'NOT_FOUND',
        message: 'Account not found.',
      };
    }

    if (exception instanceof ConsentRequiredError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'CONSENT_REQUIRED',
        message: exception.message,
      };
    }

    if (exception instanceof InvalidConsentVersionError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'INVALID_CONSENT_VERSION',
        message: exception.message,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      // Validation errors (400) get a generic message; other HTTP exceptions
      // (401/403/423/429 …) keep their framework message which carries no
      // sensitive detail.
      const code = this.codeForStatus(status);
      const message =
        status === HttpStatus.BAD_REQUEST
          ? 'Invalid input'
          : this.messageFromHttpException(exception);
      return { status, code, message };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    };
  }

  private messageFromHttpException(exception: HttpException): string {
    const res = exception.getResponse();
    if (typeof res === 'string') return res;
    if (res && typeof res === 'object' && 'message' in res) {
      const m = (res as { message: unknown }).message;
      if (typeof m === 'string') return m;
    }
    return exception.message;
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'VALIDATION_ERROR';
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHORIZED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HTTP_LOCKED:
        return 'ACCOUNT_LOCKED';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'RATE_LIMITED';
      default:
        return 'ERROR';
    }
  }
}

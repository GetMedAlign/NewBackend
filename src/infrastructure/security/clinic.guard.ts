import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from './current-user.decorator';

/**
 * ClinicGuard restricts access to clinic-portal routes.
 *
 * It must be applied AFTER the global JwtCookieGuard has already populated
 * request.user. It allows the request only when:
 *   - request.user.role === 'clinic'
 *   - request.user.clinicId is a non-empty string
 *
 * Apply per-controller or per-handler via @UseGuards(ClinicGuard).
 */
@Injectable()
export class ClinicGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();

    const user = request.user;

    if (user?.role === 'clinic' && typeof user.clinicId === 'string' && user.clinicId.length > 0) {
      return true;
    }

    throw new ForbiddenException('Clinic access only');
  }
}

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from './current-user.decorator';

/**
 * Resolves the clinic id of the authenticated clinic user.
 *
 * Must be used on routes already protected by ClinicGuard, which guarantees
 * request.user.clinicId is a non-empty string before this decorator runs.
 */
export const CurrentClinic = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    /* invariant: ClinicGuard has already asserted a non-empty clinicId on this route */
    return request.user!.clinicId as string;
  },
);

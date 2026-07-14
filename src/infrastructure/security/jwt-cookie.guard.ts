import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import {
  TOKEN_SERVICE,
  TokenServicePort,
} from '../../modules/auth/domain/ports/token-service.port';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ACCESS_TOKEN_COOKIE } from './cookie';
import type { AuthenticatedUser } from './current-user.decorator';

/**
 * Global fail-closed authentication guard. Every route requires a valid
 * access_token cookie unless the handler/class is marked @Public().
 */
@Injectable()
export class JwtCookieGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenServicePort,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context
      .switchToHttp()
      .getRequest<Request & { cookies?: Record<string, string>; user?: AuthenticatedUser }>();

    const token = request.cookies?.[ACCESS_TOKEN_COOKIE];

    if (isPublic) {
      // Best-effort populate user for public routes that still want it, but
      // never reject on a missing/invalid token.
      if (token) {
        try {
          const claims = this.tokens.verify(token);
          request.user = { sub: claims.sub, role: claims.role, clinicId: claims.clinicId ?? null };
        } catch {
          // ignore — public route
        }
      }
      return true;
    }

    if (!token) {
      throw new UnauthorizedException('Authentication required');
    }

    let claims;
    try {
      claims = this.tokens.verify(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    request.user = { sub: claims.sub, role: claims.role, clinicId: claims.clinicId ?? null };
    return true;
  }
}

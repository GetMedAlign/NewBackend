import { ForbiddenException, Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

export const CSRF_COOKIE = 'csrf_token';
export const CSRF_HEADER = 'x-csrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit CSRF protection.
 *
 * - Ensures a non-HttpOnly `csrf_token` cookie exists on every response so the
 *   SPA can read it and echo it back in the `x-csrf-token` header.
 * - For every state-changing request (non GET/HEAD/OPTIONS) the header must
 *   equal the cookie, otherwise the request is rejected with 403.
 *
 * Enforcement is skipped when `NODE_ENV === 'development'` so local API tools
 * (Postman/curl) can hit POST routes without the double-submit dance. CSRF is
 * fully enforced in `test` (so the e2e coverage stands) and `production`.
 */
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  constructor(private readonly config: ConfigService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies ?? {};
    let token = cookies[CSRF_COOKIE];

    if (!token) {
      token = randomBytes(32).toString('hex');
      res.cookie(CSRF_COOKIE, token, {
        httpOnly: false,
        sameSite: 'lax',
        path: '/',
      });
    }

    const isDevelopment = this.config.get<string>('NODE_ENV') === 'development';

    if (!isDevelopment && !SAFE_METHODS.has(req.method)) {
      const header = req.headers[CSRF_HEADER];
      const headerValue = Array.isArray(header) ? header[0] : header;
      const cookieValue = cookies[CSRF_COOKIE];

      if (!cookieValue || !headerValue || headerValue !== cookieValue) {
        throw new ForbiddenException('Invalid CSRF token');
      }
    }

    next();
  }
}

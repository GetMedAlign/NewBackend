import type { Response } from 'express';
import type { CookieOptions } from 'express';

export const ACCESS_TOKEN_COOKIE = 'access_token';

/**
 * Builds the cookie options shared by set/clear so the flags are identical
 * (a mismatched clear leaves the cookie in the browser).
 */
function baseOptions(): CookieOptions {
  const domain = process.env['COOKIE_DOMAIN'];
  const options: CookieOptions = {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'lax',
    path: '/',
  };
  if (domain) options.domain = domain;
  return options;
}

export function setAuthCookie(res: Response, token: string): void {
  const expiryMinutes = Number(process.env['JWT_EXPIRY_MINUTES'] ?? '60');
  res.cookie(ACCESS_TOKEN_COOKIE, token, {
    ...baseOptions(),
    maxAge: expiryMinutes * 60 * 1000,
  });
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(ACCESS_TOKEN_COOKIE, baseOptions());
}

export interface TokenClaims {
  sub: string;
  role: string;
  clinicId?: string | null;
}

export interface TokenServicePort {
  issue(claims: TokenClaims): string;
  verify(token: string): TokenClaims;
}

export const TOKEN_SERVICE = Symbol('TokenServicePort');

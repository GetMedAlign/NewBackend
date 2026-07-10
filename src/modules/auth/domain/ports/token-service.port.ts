export interface TokenClaims {
  sub: string;
  role: string;
}

export interface TokenServicePort {
  issue(claims: TokenClaims): string;
  verify(token: string): TokenClaims;
}

export const TOKEN_SERVICE = Symbol('TokenServicePort');

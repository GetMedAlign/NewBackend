import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { TokenClaims, TokenServicePort } from '../../domain/ports/token-service.port';

interface JwtPayload {
  sub: string;
  role: string;
}

@Injectable()
export class JwtTokenService implements TokenServicePort {
  constructor(
    private readonly jwtService: JwtService,
    private readonly secret: string,
    private readonly expiryMinutes: number,
  ) {}

  issue(claims: TokenClaims): string {
    const payload: JwtPayload = { sub: claims.sub, role: claims.role };
    return this.jwtService.sign(payload, {
      secret: this.secret,
      expiresIn: `${this.expiryMinutes}m`,
    });
  }

  verify(token: string): TokenClaims {
    const payload = this.jwtService.verify<JwtPayload>(token, {
      secret: this.secret,
    });
    return { sub: payload.sub, role: payload.role };
  }
}

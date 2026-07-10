import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { SignUpUseCase } from '../../application/sign-up.use-case';
import { SignInUseCase } from '../../application/sign-in.use-case';
import { VerifyTwoFactorUseCase } from '../../application/verify-two-factor.use-case';
import { ResendTwoFactorUseCase } from '../../application/resend-two-factor.use-case';
import { GetMeUseCase } from '../../application/get-me.use-case';
import { SignOutUseCase } from '../../application/sign-out.use-case';

import { Public } from '../../../../infrastructure/security/public.decorator';
import { CurrentUser } from '../../../../infrastructure/security/current-user.decorator';
import type { AuthenticatedUser } from '../../../../infrastructure/security/current-user.decorator';
import {
  setAuthCookie,
  clearAuthCookie,
} from '../../../../infrastructure/security/cookie';

import { SignupDto } from './dtos/signup.dto';
import { SigninDto } from './dtos/signin.dto';
import { Verify2faDto } from './dtos/verify-2fa.dto';
import { Resend2faDto } from './dtos/resend-2fa.dto';

/** Stricter per-IP throttle for the unauthenticated auth surface. */
const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly signUp: SignUpUseCase,
    private readonly signIn: SignInUseCase,
    private readonly verifyTwoFactor: VerifyTwoFactorUseCase,
    private readonly resendTwoFactor: ResendTwoFactorUseCase,
    private readonly getMe: GetMeUseCase,
    private readonly signOut: SignOutUseCase,
  ) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  async signup(
    @Body() dto: SignupDto,
    @Req() req: Request,
  ): Promise<{ userId: string }> {
    const { userId } = await this.signUp.execute({
      email: dto.email,
      password: dto.password,
      ip: req.ip,
    });
    return { userId };
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('signin')
  @HttpCode(HttpStatus.OK)
  async signin(
    @Body() dto: SigninDto,
    @Req() req: Request,
  ): Promise<{ requiresTwoFactor: true }> {
    return this.signIn.execute({
      email: dto.email,
      password: dto.password,
      ip: req.ip,
    });
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  async verify(
    @Body() dto: Verify2faDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ userId: string; role: string }> {
    const result = await this.verifyTwoFactor.execute({
      email: dto.email,
      code: dto.code,
      ip: req.ip,
    });
    setAuthCookie(res, result.token);
    return { userId: result.userId, role: result.role };
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('2fa/send')
  @HttpCode(HttpStatus.OK)
  async resend(@Body() dto: Resend2faDto): Promise<{ ok: true }> {
    return this.resendTwoFactor.execute({ email: dto.email });
  }

  @Post('signout')
  @HttpCode(HttpStatus.OK)
  async signout(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const result = await this.signOut.execute({ userId: user.sub });
    clearAuthCookie(res);
    return result;
  }

  @Get('me')
  @HttpCode(HttpStatus.OK)
  async me(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ userId: string; email: string; role: string }> {
    return this.getMe.execute({ userId: user.sub });
  }
}

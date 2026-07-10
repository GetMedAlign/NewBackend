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
import {
  ApiBody,
  ApiCookieAuth,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
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

/** Header required on all non-GET requests (CSRF protection). */
const CSRF_HEADER = {
  name: 'x-csrf-token',
  description: 'CSRF token — required on all non-GET requests. Value is provided by the server.',
  required: true,
};

@ApiTags('Auth')
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
  @ApiOperation({ summary: 'Register a new user', description: 'Creates a new user account and triggers a 2FA email.' })
  @ApiHeader(CSRF_HEADER)
  @ApiBody({ type: SignupDto })
  @ApiResponse({ status: 201, description: 'User created', schema: { example: { userId: 'uuid-here' } } })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  @ApiResponse({ status: 422, description: 'Validation error' })
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
  @ApiOperation({
    summary: 'Sign in with email and password',
    description: 'Validates credentials and triggers a 2FA email. The session is only established after POST /auth/2fa/verify.',
  })
  @ApiHeader(CSRF_HEADER)
  @ApiBody({ type: SigninDto })
  @ApiResponse({ status: 200, description: '2FA code sent', schema: { example: { requiresTwoFactor: true } } })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 403, description: 'Account locked' })
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
  @ApiOperation({
    summary: 'Verify 2FA code and obtain session',
    description: 'Validates the OTP emailed after sign-in. On success, sets an HttpOnly `access_token` cookie that authenticates subsequent requests.',
  })
  @ApiHeader(CSRF_HEADER)
  @ApiBody({ type: Verify2faDto })
  @ApiResponse({
    status: 200,
    description: 'Authentication successful — access_token cookie set',
    schema: { example: { userId: 'uuid-here', role: 'patient' } },
  })
  @ApiResponse({ status: 401, description: 'Invalid or expired OTP' })
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
  @ApiOperation({
    summary: 'Resend 2FA code',
    description: 'Generates and emails a new OTP for the given address. Rate-limited.',
  })
  @ApiHeader(CSRF_HEADER)
  @ApiBody({ type: Resend2faDto })
  @ApiResponse({ status: 200, description: '2FA code sent', schema: { example: { ok: true } } })
  async resend(@Body() dto: Resend2faDto): Promise<{ ok: true }> {
    return this.resendTwoFactor.execute({ email: dto.email });
  }

  @Post('signout')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Sign out', description: 'Invalidates the current session and clears the access_token cookie.' })
  @ApiHeader(CSRF_HEADER)
  @ApiResponse({ status: 200, description: 'Signed out', schema: { example: { ok: true } } })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
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
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Get current user', description: 'Returns the authenticated user\'s profile. Requires a valid access_token cookie.' })
  @ApiResponse({
    status: 200,
    description: 'Current user info',
    schema: { example: { userId: 'uuid-here', email: 'user@example.com', role: 'patient' } },
  })
  @ApiResponse({ status: 401, description: 'Not authenticated' })
  async me(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ userId: string; email: string; role: string }> {
    return this.getMe.execute({ userId: user.sub });
  }
}

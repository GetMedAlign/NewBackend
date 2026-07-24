import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Put, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { CurrentUser } from '../../../../infrastructure/security/current-user.decorator';
import type { AuthenticatedUser } from '../../../../infrastructure/security/current-user.decorator';
import { clearAuthCookie } from '../../../../infrastructure/security/cookie';
import { GetProfileUseCase } from '../../application/get-profile.use-case';
import { UpdateProfileUseCase } from '../../application/update-profile.use-case';
import { GetMyLeadsUseCase } from '../../application/get-my-leads.use-case';
import { DeleteAccountUseCase } from '../../application/delete-account.use-case';
import type { PatientLeadView } from '../../../leads/domain/ports/lead-repository.port';
import { UpdateProfileDto } from './dtos/update-profile.dto';

@ApiTags('patients')
@ApiCookieAuth('access_token')
@Controller('patients')
export class PatientsController {
  constructor(
    private readonly getProfile: GetProfileUseCase,
    private readonly updateProfile: UpdateProfileUseCase,
    private readonly getMyLeads: GetMyLeadsUseCase,
    private readonly deleteAccount: DeleteAccountUseCase,
  ) {}

  @Get('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get the authenticated patient profile' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 401 })
  @ApiResponse({ status: 404 })
  async getMe(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ name: string; email: string; dob: string | null; zipCode: string | null }> {
    return this.getProfile.execute(user.sub);
  }

  @Put('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update the authenticated patient profile' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 401 })
  @ApiResponse({ status: 404 })
  async putMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<{ success: true }> {
    await this.updateProfile.execute(user.sub, { name: dto.name, dob: dto.dob });
    return { success: true };
  }

  @Get('me/leads')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get the authenticated patient lead history' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 401 })
  async getMyLeadsHandler(@CurrentUser() user: AuthenticatedUser): Promise<PatientLeadView[]> {
    return this.getMyLeads.execute(user.sub);
  }

  @Delete('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete the authenticated patient account and end the session' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 401 })
  @ApiResponse({ status: 404 })
  async deleteMe(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: true }> {
    const result = await this.deleteAccount.execute(user.sub);
    clearAuthCookie(res);
    return result;
  }
}

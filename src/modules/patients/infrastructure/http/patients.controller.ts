import { Body, Controller, Get, HttpCode, HttpStatus, Put } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../../../infrastructure/security/current-user.decorator';
import type { AuthenticatedUser } from '../../../../infrastructure/security/current-user.decorator';
import { GetProfileUseCase } from '../../application/get-profile.use-case';
import { UpdateProfileUseCase } from '../../application/update-profile.use-case';
import { GetMyLeadsUseCase } from '../../application/get-my-leads.use-case';
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
}

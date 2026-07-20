import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../../../../infrastructure/security/roles.decorator';
import { RolesGuard } from '../../../../infrastructure/security/roles.guard';
import { CurrentUser } from '../../../../infrastructure/security/current-user.decorator';
import type { AuthenticatedUser } from '../../../../infrastructure/security/current-user.decorator';
import { PhiAccessInterceptor } from './phi-access.interceptor';
import { ListPatientsUseCase } from '../../application/list-patients.use-case';
import { GetPatientUseCase } from '../../application/get-patient.use-case';
import { UpdatePatientUseCase } from '../../application/update-patient.use-case';
import { SoftDeletePatientUseCase } from '../../application/soft-delete-patient.use-case';
import { SendPatientPasswordResetUseCase } from '../../application/send-patient-password-reset.use-case';
import { SetPatientPasswordUseCase } from '../../application/set-patient-password.use-case';
import type { AdminPatientDto } from '../../domain/patient-dto.mapper';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { SetPasswordDto } from '../../../../infrastructure/http/dto/set-password.dto';

/** Tighter rate limit for the list route, which returns identifying information for every patient in one call. */
const PHI_THROTTLE = { default: { limit: 20, ttl: 60_000 } };

@ApiTags('Admin — Patients')
@ApiCookieAuth('access_token')
@Controller('admin/patients')
@Roles('admin', 'superadmin')
@UseGuards(RolesGuard)
@UseInterceptors(PhiAccessInterceptor)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class AdminPatientsController {
  constructor(
    private readonly listPatients: ListPatientsUseCase,
    private readonly getPatient: GetPatientUseCase,
    private readonly updatePatient: UpdatePatientUseCase,
    private readonly softDeletePatient: SoftDeletePatientUseCase,
    private readonly sendPatientPasswordReset: SendPatientPasswordResetUseCase,
    private readonly setPatientPassword: SetPatientPasswordUseCase,
  ) {}

  @ApiOperation({ summary: 'List all patients (admin only)' })
  @Get()
  @Throttle(PHI_THROTTLE)
  async list(@CurrentUser() user: AuthenticatedUser, @Ip() ip: string): Promise<AdminPatientDto[]> {
    return this.listPatients.execute({ userId: user.sub, role: user.role, ip });
  }

  @ApiOperation({ summary: 'Get a single patient by id (admin only)' })
  @Get(':id')
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
  ): Promise<AdminPatientDto> {
    return this.getPatient.execute({ userId: user.sub, role: user.role, ip }, id);
  }

  @ApiOperation({ summary: 'Partially update a patient (admin only)' })
  @Put(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdatePatientDto,
    @Ip() ip: string,
  ): Promise<{ success: true }> {
    return this.updatePatient.execute({ userId: user.sub, role: user.role, ip }, id, body);
  }

  @ApiOperation({ summary: 'Soft-delete a patient and lock their account out (admin only)' })
  @Delete(':id')
  @HttpCode(200)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
  ): Promise<{ success: true }> {
    return this.softDeletePatient.execute({ userId: user.sub, role: user.role, ip }, id);
  }

  @ApiOperation({
    summary: "Email a password reset link to the patient's linked user (admin only)",
  })
  @Post(':id/send-password-reset')
  @HttpCode(200)
  async sendPasswordReset(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
  ): Promise<{ success: true }> {
    return this.sendPatientPasswordReset.execute({ userId: user.sub, role: user.role, ip }, id);
  }

  @ApiOperation({ summary: "Directly set the patient's linked user's password (admin only)" })
  @Post(':id/set-password')
  @HttpCode(200)
  async setPassword(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SetPasswordDto,
    @Ip() ip: string,
  ): Promise<{ success: true }> {
    return this.setPatientPassword.execute(
      { userId: user.sub, role: user.role, ip },
      id,
      body.newPassword,
    );
  }
}

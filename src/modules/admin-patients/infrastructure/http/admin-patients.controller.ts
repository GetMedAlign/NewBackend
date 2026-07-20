import {
  Controller,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
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
import type { AdminPatientDto } from '../../domain/patient-dto.mapper';

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
}

import { Controller, Get, HttpCode, HttpStatus, Inject } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../../../infrastructure/security/current-user.decorator';
import type { AuthenticatedUser } from '../../../../infrastructure/security/current-user.decorator';
import { PATIENT_REPOSITORY } from '../../../patients/domain/ports/patient-repository.port';
import type { PatientRepositoryPort } from '../../../patients/domain/ports/patient-repository.port';
import { ListPatientAppointmentsUseCase } from '../../application/list-patient-appointments.use-case';
import { AppointmentDto } from './dto/appointment.dto';

/**
 * Patient-facing appointment history. Reuses the exact same auth pattern as
 * `PatientsController` (`patients/me/*`): no explicit guard here, relying on
 * the global JwtCookieGuard + RolesGuard, with `@CurrentUser()` supplying
 * the authenticated user id.
 */
@ApiTags('patients')
@ApiCookieAuth('access_token')
@Controller('patients/me')
export class PatientAppointmentsController {
  constructor(
    @Inject(PATIENT_REPOSITORY) private readonly patientRepository: PatientRepositoryPort,
    private readonly listPatientAppointmentsUseCase: ListPatientAppointmentsUseCase,
  ) {}

  @Get('appointments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get the authenticated patient appointment history' })
  @ApiOkResponse({ type: AppointmentDto, isArray: true })
  async getMyAppointments(@CurrentUser() user: AuthenticatedUser): Promise<AppointmentDto[]> {
    const patientId = await this.patientRepository.findPatientIdByUserId(user.sub);
    if (!patientId) {
      return [];
    }
    // No anonymous-session appointments to also surface here yet: the
    // authenticated patient is scoped strictly to their own patientId.
    return this.listPatientAppointmentsUseCase.execute({ patientId, sessionId: '' });
  }
}

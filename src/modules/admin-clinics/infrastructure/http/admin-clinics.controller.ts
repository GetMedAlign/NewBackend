import {
  Controller,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../../../infrastructure/security/roles.decorator';
import { RolesGuard } from '../../../../infrastructure/security/roles.guard';
import { CurrentUser } from '../../../../infrastructure/security/current-user.decorator';
import type { AuthenticatedUser } from '../../../../infrastructure/security/current-user.decorator';
import { GetClinicUseCase } from '../../application/get-clinic.use-case';
import { ListClinicsUseCase } from '../../application/list-clinics.use-case';
import type { AdminClinicDto } from '../../domain/clinic-dto.mapper';

@ApiTags('Admin — Clinics')
@ApiCookieAuth('access_token')
@Controller('admin/clinics')
@Roles('admin', 'superadmin')
@UseGuards(RolesGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class AdminClinicsController {
  constructor(
    private readonly listClinics: ListClinicsUseCase,
    private readonly getClinic: GetClinicUseCase,
  ) {}

  @ApiOperation({ summary: 'List all clinics (admin only)' })
  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Ip() ip: string): Promise<AdminClinicDto[]> {
    return this.listClinics.execute({ userId: user.sub, role: user.role, ip });
  }

  @ApiOperation({ summary: 'Get a single clinic by id (admin only)' })
  @Get(':id')
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
  ): Promise<AdminClinicDto> {
    return this.getClinic.execute({ userId: user.sub, role: user.role, ip }, id);
  }
}

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
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
import { UpdateClinicUseCase } from '../../application/update-clinic.use-case';
import { PauseDeliveryUseCase } from '../../application/pause-delivery.use-case';
import { ListClinicLeadsUseCase } from '../../application/list-clinic-leads.use-case';
import { ListNotesUseCase } from '../../application/list-notes.use-case';
import { AddNoteUseCase } from '../../application/add-note.use-case';
import type { AdminClinicDto } from '../../domain/clinic-dto.mapper';
import { UpdateClinicDto } from './dto/update-clinic.dto';
import { PauseDeliveryDto } from './dto/pause-delivery.dto';
import { AddNoteDto } from './dto/add-note.dto';
import type { AdminLeadRow } from './dto/admin-lead-row.dto';
import type { AdminNote } from './dto/admin-note.dto';

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
    private readonly updateClinic: UpdateClinicUseCase,
    private readonly pauseDelivery: PauseDeliveryUseCase,
    private readonly listClinicLeads: ListClinicLeadsUseCase,
    private readonly listNotes: ListNotesUseCase,
    private readonly addNote: AddNoteUseCase,
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

  @ApiOperation({ summary: 'Partially update a clinic (admin only)' })
  @Put(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateClinicDto,
    @Ip() ip: string,
  ): Promise<{ success: true }> {
    await this.updateClinic.execute({ userId: user.sub, role: user.role, ip }, id, body);
    return { success: true };
  }

  @ApiOperation({ summary: 'Pause or resume lead delivery for a clinic (admin only)' })
  @Post(':id/pause-delivery')
  @HttpCode(200)
  async setPauseDelivery(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PauseDeliveryDto,
    @Ip() ip: string,
  ): Promise<{ success: true }> {
    await this.pauseDelivery.execute({ userId: user.sub, role: user.role, ip }, id, body.paused);
    return { success: true };
  }

  @ApiOperation({ summary: "List a clinic's leads (admin only)" })
  @Get(':id/leads')
  async listLeads(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
  ): Promise<AdminLeadRow[]> {
    return this.listClinicLeads.execute({ userId: user.sub, role: user.role, ip }, id);
  }

  @ApiOperation({ summary: "List a clinic's admin notes (admin only)" })
  @Get(':id/notes')
  async listClinicNotes(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
  ): Promise<AdminNote[]> {
    return this.listNotes.execute({ userId: user.sub, role: user.role, ip }, id);
  }

  @ApiOperation({ summary: 'Add an admin note to a clinic (admin only)' })
  @Post(':id/notes')
  async addClinicNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddNoteDto,
    @Ip() ip: string,
  ): Promise<AdminNote> {
    return this.addNote.execute({ userId: user.sub, role: user.role, ip }, id, body.body);
  }
}

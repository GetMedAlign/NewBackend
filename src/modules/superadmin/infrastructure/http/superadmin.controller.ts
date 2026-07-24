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
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Roles } from '../../../../infrastructure/security/roles.decorator';
import { RolesGuard } from '../../../../infrastructure/security/roles.guard';
import { CurrentUser } from '../../../../infrastructure/security/current-user.decorator';
import type { AuthenticatedUser } from '../../../../infrastructure/security/current-user.decorator';
import { ListAdminsUseCase } from '../../application/list-admins.use-case';
import { CreateAdminUseCase } from '../../application/create-admin.use-case';
import { DeleteAdminUseCase } from '../../application/delete-admin.use-case';
import { SetAdminPasswordUseCase } from '../../application/set-admin-password.use-case';
import { CreateAdminDto } from './dto/create-admin.dto';
import { SetAdminPasswordDto } from './dto/set-admin-password.dto';
import type { AdminUserDto } from './dto/admin-user.dto';

@ApiTags('Superadmin — Team')
@ApiCookieAuth('access_token')
@Controller('superadmin/admins')
@Roles('superadmin')
@UseGuards(RolesGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class SuperadminController {
  constructor(
    private readonly listAdmins: ListAdminsUseCase,
    private readonly createAdmin: CreateAdminUseCase,
    private readonly deleteAdmin: DeleteAdminUseCase,
    private readonly setAdminPassword: SetAdminPasswordUseCase,
  ) {}

  @ApiOperation({ summary: 'List all admin/superadmin users (superadmin only)' })
  @Get()
  async list(@CurrentUser() user: AuthenticatedUser, @Ip() ip: string): Promise<AdminUserDto[]> {
    return this.listAdmins.execute({ userId: user.sub, role: user.role, ip });
  }

  @ApiOperation({ summary: 'Create a new admin/superadmin user (superadmin only)' })
  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateAdminDto,
    @Ip() ip: string,
  ): Promise<AdminUserDto> {
    return this.createAdmin.execute(
      { userId: user.sub, role: user.role, ip },
      {
        name: body.name,
        email: body.email,
        password: body.password,
        role: body.role,
      },
    );
  }

  @ApiOperation({
    summary: 'Delete an admin/superadmin user (superadmin only)',
    description:
      'Hard-deletes the user; user_roles cascades. A superadmin may not delete their own account.',
  })
  @Delete(':id')
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
  ): Promise<{ success: true }> {
    return this.deleteAdmin.execute({ userId: user.sub, role: user.role, ip }, id);
  }

  @ApiOperation({ summary: "Directly set an admin/superadmin user's password (superadmin only)" })
  @Put(':id/password')
  @HttpCode(200)
  async setPassword(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SetAdminPasswordDto,
    @Ip() ip: string,
  ): Promise<{ success: true }> {
    return this.setAdminPassword.execute(
      { userId: user.sub, role: user.role, ip },
      id,
      body.newPassword,
    );
  }
}

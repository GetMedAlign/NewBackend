import { Controller, Get, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../../../infrastructure/security/roles.decorator';
import { RolesGuard } from '../../../../infrastructure/security/roles.guard';
import { CurrentUser } from '../../../../infrastructure/security/current-user.decorator';
import type { AuthenticatedUser } from '../../../../infrastructure/security/current-user.decorator';
import { GetRevenueStatsUseCase } from '../../application/get-revenue-stats.use-case';
import { GetRevenueClinicsUseCase } from '../../application/get-revenue-clinics.use-case';
import { RevenueStatsDto } from './dto/revenue-stats.dto';
import { ClinicRevenueRowDto } from './dto/clinic-revenue-row.dto';

@ApiTags('Admin — Revenue')
@ApiCookieAuth('access_token')
@Controller('admin/revenue')
@Roles('admin', 'superadmin')
@UseGuards(RolesGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class AdminRevenueController {
  constructor(
    private readonly getRevenueStats: GetRevenueStatsUseCase,
    private readonly getRevenueClinics: GetRevenueClinicsUseCase,
  ) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get platform-wide revenue stats (admin only)' })
  getStats(@CurrentUser() user: AuthenticatedUser): Promise<RevenueStatsDto> {
    return this.getRevenueStats.execute({ userId: user.sub, role: user.role }, new Date());
  }

  @Get('clinics')
  @ApiOperation({ summary: 'Get per-clinic revenue rows, ordered by clinic name (admin only)' })
  getClinics(@CurrentUser() user: AuthenticatedUser): Promise<ClinicRevenueRowDto[]> {
    return this.getRevenueClinics.execute({ userId: user.sub, role: user.role }, new Date());
  }
}

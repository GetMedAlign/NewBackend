import { Controller, Get, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../../../infrastructure/security/roles.decorator';
import { RolesGuard } from '../../../../infrastructure/security/roles.guard';
import { CurrentUser } from '../../../../infrastructure/security/current-user.decorator';
import type { AuthenticatedUser } from '../../../../infrastructure/security/current-user.decorator';
import { GetRevenueStatsUseCase } from '../../application/get-revenue-stats.use-case';
import { RevenueStatsDto } from './dto/revenue-stats.dto';

@ApiTags('Admin — Revenue')
@ApiCookieAuth('access_token')
@Controller('admin/revenue')
@Roles('admin', 'superadmin')
@UseGuards(RolesGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class AdminRevenueController {
  constructor(private readonly getRevenueStats: GetRevenueStatsUseCase) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get platform-wide revenue stats (admin only)' })
  getStats(@CurrentUser() user: AuthenticatedUser): Promise<RevenueStatsDto> {
    return this.getRevenueStats.execute({ userId: user.sub, role: user.role }, new Date());
  }
}

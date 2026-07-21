import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Put,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClinicGuard } from '../../../../infrastructure/security/clinic.guard';
import { CurrentClinic } from '../../../../infrastructure/security/current-clinic.decorator';
import { GetClinicBillingUseCase } from '../../application/get-clinic-billing.use-case';
import { UpdateClinicBillingUseCase } from '../../application/update-clinic-billing.use-case';
import { ClinicBillingInfoDto } from './dto/clinic-billing-info.dto';
import { UpdateClinicBillingDto } from './dto/update-clinic-billing.dto';

@ApiTags('Clinic Portal — Billing')
@ApiCookieAuth('access_token')
@Controller('clinic/portal')
@UseGuards(ClinicGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class ClinicBillingController {
  constructor(
    private readonly getClinicBilling: GetClinicBillingUseCase,
    private readonly updateClinicBilling: UpdateClinicBillingUseCase,
  ) {}

  @Get('billing')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get the authenticated clinic billing profile and fee estimate' })
  getBilling(@CurrentClinic() clinicId: string): Promise<ClinicBillingInfoDto> {
    return this.getClinicBilling.execute({ clinicId }, new Date());
  }

  @Put('billing')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Upsert the authenticated clinic billing profile; a changed billing email is ' +
      'synced to Stripe best-effort',
  })
  updateBilling(
    @CurrentClinic() clinicId: string,
    @Body() body: UpdateClinicBillingDto,
  ): Promise<{ success: boolean }> {
    return this.updateClinicBilling.execute({ clinicId }, body);
  }
}

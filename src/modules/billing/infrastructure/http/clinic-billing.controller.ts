import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClinicGuard } from '../../../../infrastructure/security/clinic.guard';
import { CurrentClinic } from '../../../../infrastructure/security/current-clinic.decorator';
import { GetClinicBillingUseCase } from '../../application/get-clinic-billing.use-case';
import { UpdateClinicBillingUseCase } from '../../application/update-clinic-billing.use-case';
import { GetPaymentMethodUseCase } from '../../application/get-payment-method.use-case';
import { SavePaymentMethodUseCase } from '../../application/save-payment-method.use-case';
import { RemovePaymentMethodUseCase } from '../../application/remove-payment-method.use-case';
import { CancelSubscriptionUseCase } from '../../application/cancel-subscription.use-case';
import { ClinicBillingInfoDto } from './dto/clinic-billing-info.dto';
import { UpdateClinicBillingDto } from './dto/update-clinic-billing.dto';
import { PaymentMethodDto } from './dto/payment-method.dto';
import { SavePaymentMethodDto } from './dto/save-payment-method.dto';
import { CancelSubscriptionResponseDto } from './dto/cancel-subscription-response.dto';

@ApiTags('Clinic Portal — Billing')
@ApiCookieAuth('access_token')
@Controller('clinic/portal')
@UseGuards(ClinicGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class ClinicBillingController {
  constructor(
    private readonly getClinicBilling: GetClinicBillingUseCase,
    private readonly updateClinicBilling: UpdateClinicBillingUseCase,
    private readonly getPaymentMethod: GetPaymentMethodUseCase,
    private readonly savePaymentMethod: SavePaymentMethodUseCase,
    private readonly removePaymentMethod: RemovePaymentMethodUseCase,
    private readonly cancelSubscription: CancelSubscriptionUseCase,
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

  @Get('payment-method')
  @ApiOperation({
    summary: "Get the clinic's default payment method, read live from Stripe; null if none",
  })
  @ApiOkResponse({ type: PaymentMethodDto })
  async getPaymentMethodInfo(
    @CurrentClinic() clinicId: string,
    @Res() res: Response,
  ): Promise<void> {
    // Bypasses Nest's default reply handling (which sends an empty body for a
    // null/undefined return value) so the contract's `null` (spec §1.4) is a
    // literal JSON `null`, not an empty response.
    const dto = await this.getPaymentMethod.execute({ clinicId });
    res.status(HttpStatus.OK).json(dto);
  }

  @Post('payment-method')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Attach a payment method as the clinic's Stripe default",
  })
  savePaymentMethodInfo(
    @CurrentClinic() clinicId: string,
    @Body() body: SavePaymentMethodDto,
  ): Promise<PaymentMethodDto> {
    return this.savePaymentMethod.execute({ clinicId }, body.paymentMethodId);
  }

  @Delete('payment-method')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Detach the clinic's default payment method (best-effort)",
  })
  removePaymentMethodInfo(@CurrentClinic() clinicId: string): Promise<{ success: boolean }> {
    return this.removePaymentMethod.execute({ clinicId });
  }

  @Post('subscription/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel the clinic subscription; stays active through the end of the current month',
  })
  @ApiOkResponse({ type: CancelSubscriptionResponseDto })
  cancelSubscriptionInfo(
    @CurrentClinic() clinicId: string,
  ): Promise<CancelSubscriptionResponseDto> {
    return this.cancelSubscription.execute({ clinicId }, new Date());
  }
}

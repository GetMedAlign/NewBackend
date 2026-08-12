import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClinicGuard } from '../../../../infrastructure/security/clinic.guard';
import { CurrentClinic } from '../../../../infrastructure/security/current-clinic.decorator';
import { GetSchedulingStatusUseCase } from '../../application/get-scheduling-status.use-case';
import { ConnectAuthorizeUrlUseCase } from '../../application/connect-authorize-url.use-case';
import { CalendlyCallbackUseCase } from '../../application/calendly-callback.use-case';
import { DisconnectSchedulingUseCase } from '../../application/disconnect-scheduling.use-case';
import { SchedulingStatusDto } from './dto/scheduling-status.dto';
import { AuthorizeUrlDto } from './dto/authorize-url.dto';
import { CalendlyCallbackDto, CalendlyCallbackResponseDto } from './dto/calendly-callback.dto';
import { DisconnectSchedulingResponseDto } from './dto/disconnect-scheduling.dto';

@ApiTags('Clinic Portal Scheduling')
@ApiCookieAuth('access_token')
@Controller('clinic/portal/scheduling')
@UseGuards(ClinicGuard)
export class SchedulingController {
  constructor(
    private readonly getStatusUseCase: GetSchedulingStatusUseCase,
    private readonly connectAuthorizeUrlUseCase: ConnectAuthorizeUrlUseCase,
    private readonly calendlyCallbackUseCase: CalendlyCallbackUseCase,
    private readonly disconnectUseCase: DisconnectSchedulingUseCase,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get the scheduling connection status for the authenticated clinic' })
  async getStatus(@CurrentClinic() clinicId: string): Promise<SchedulingStatusDto> {
    return this.getStatusUseCase.execute(clinicId);
  }

  @Get('calendly/authorize-url')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Build the Calendly OAuth authorize URL for the authenticated clinic' })
  getAuthorizeUrl(@CurrentClinic() clinicId: string): AuthorizeUrlDto {
    return this.connectAuthorizeUrlUseCase.execute(clinicId);
  }

  @Post('calendly/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete the Calendly OAuth flow and persist the connection' })
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async calendlyCallback(
    @CurrentClinic() clinicId: string,
    @Body() dto: CalendlyCallbackDto,
  ): Promise<CalendlyCallbackResponseDto> {
    return this.calendlyCallbackUseCase.execute(clinicId, dto.code, dto.state);
  }

  @Post('disconnect')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disconnect the scheduling provider for the authenticated clinic' })
  async disconnect(@CurrentClinic() clinicId: string): Promise<DisconnectSchedulingResponseDto> {
    return this.disconnectUseCase.execute(clinicId);
  }
}

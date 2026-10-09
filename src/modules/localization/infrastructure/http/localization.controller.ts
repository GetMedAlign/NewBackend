import { Body, Controller, Get, Param, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../../infrastructure/security/public.decorator';
import { GetCitiesUseCase } from '../../application/get-cities.use-case';
import { GetCityUseCase } from '../../application/get-city.use-case';
import { GetServicesUseCase } from '../../application/get-services.use-case';
import { GetServiceUseCase } from '../../application/get-service.use-case';
import { GetComboUseCase } from '../../application/get-combo.use-case';
import { GetCoverageUseCase } from '../../application/get-coverage.use-case';
import { CaptureNotifyUseCase } from '../../application/capture-notify.use-case';
import { NotifyRequestDto } from './dto/notify-request.dto';
import {
  CityDetailDto,
  CityListDto,
  ComboDetailDto,
  CoverageDto,
  NotifyResponseDto,
  ServiceDetailDto,
  ServiceListDto,
} from '../../domain/localization.dto';

@ApiTags('localization')
@Controller('localization')
export class LocalizationController {
  constructor(
    private readonly getCities: GetCitiesUseCase,
    private readonly getCity: GetCityUseCase,
    private readonly getServices: GetServicesUseCase,
    private readonly getService: GetServiceUseCase,
    private readonly getCombo: GetComboUseCase,
    private readonly getCoverage: GetCoverageUseCase,
    private readonly captureNotify: CaptureNotifyUseCase,
  ) {}

  @Public()
  @Get('cities')
  @ApiOperation({ summary: 'List non-hidden Florida cities with publish state' })
  @ApiOkResponse({ type: CityListDto })
  listCities(): Promise<CityListDto> {
    return this.getCities.execute();
  }

  @Public()
  @Get('cities/:slug')
  @ApiOperation({ summary: 'City detail (clinics, services, nearby, SEO meta)' })
  @ApiParam({ name: 'slug' })
  @ApiOkResponse({ type: CityDetailDto })
  cityDetail(@Param('slug') slug: string): Promise<CityDetailDto> {
    return this.getCity.execute(slug);
  }

  @Public()
  @Get('services')
  @ApiOperation({ summary: 'List active marketing services with publish state' })
  @ApiOkResponse({ type: ServiceListDto })
  listServices(): Promise<ServiceListDto> {
    return this.getServices.execute();
  }

  @Public()
  @Get('services/:slug')
  @ApiOperation({ summary: 'Service detail (clinics, cities, related, SEO meta)' })
  @ApiParam({ name: 'slug' })
  @ApiOkResponse({ type: ServiceDetailDto })
  serviceDetail(@Param('slug') slug: string): Promise<ServiceDetailDto> {
    return this.getService.execute(slug);
  }

  @Public()
  @Get('combo/:city/:service')
  @ApiOperation({ summary: 'City + service combo detail' })
  @ApiParam({ name: 'city' })
  @ApiParam({ name: 'service' })
  @ApiOkResponse({ type: ComboDetailDto })
  comboDetail(
    @Param('city') city: string,
    @Param('service') service: string,
  ): Promise<ComboDetailDto> {
    return this.getCombo.execute(city, service);
  }

  @Public()
  @Get('coverage')
  @ApiOperation({ summary: 'Coverage matrix + threshold (drives prerender list and sitemap)' })
  @ApiOkResponse({ type: CoverageDto })
  coverage(): Promise<CoverageDto> {
    return this.getCoverage.execute();
  }

  @Public()
  @Post('notify')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  @ApiOperation({ summary: 'Capture a coming-soon notify email' })
  @ApiOkResponse({ type: NotifyResponseDto })
  notify(@Body() dto: NotifyRequestDto): Promise<NotifyResponseDto> {
    return this.captureNotify.execute({ email: dto.email, citySlug: dto.citySlug ?? null });
  }
}

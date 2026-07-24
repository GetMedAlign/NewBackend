import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../../../infrastructure/security/public.decorator';
import { GetClinicDirectoryUseCase } from '../../application/get-clinic-directory.use-case';
import { GetClinicProfileUseCase } from '../../application/get-clinic-profile.use-case';
import { ClinicDirectoryResponseDto } from '../../domain/clinic-directory.dto';
import { ClinicProfileDto } from '../../domain/clinic-profile.dto';

@ApiTags('clinics')
@Controller('clinics')
export class ClinicsController {
  constructor(
    private readonly getClinicDirectory: GetClinicDirectoryUseCase,
    private readonly getClinicProfile: GetClinicProfileUseCase,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Public, paginated clinic directory' })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'state', required: false })
  @ApiQuery({ name: 'telehealth', required: false, type: Boolean })
  @ApiQuery({ name: 'serviceCode', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'zipCode', required: false })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['rating', 'name', 'reviews', 'distance'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiOkResponse({ type: ClinicDirectoryResponseDto })
  async getDirectory(
    @Query('category') category?: string,
    @Query('state') state?: string,
    @Query('telehealth') telehealth?: string,
    @Query('serviceCode') serviceCode?: string,
    @Query('search') search?: string,
    @Query('zipCode') zipCode?: string,
    @Query('sortBy') sortBy?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<ClinicDirectoryResponseDto> {
    return this.getClinicDirectory.execute({
      category,
      state,
      telehealth,
      serviceCode,
      search,
      zipCode,
      sortBy,
      page,
      pageSize,
    });
  }

  @Public()
  @Get(':slug')
  @ApiOperation({ summary: 'Public single-clinic profile by slug' })
  @ApiParam({ name: 'slug', description: 'Clinic URL slug' })
  @ApiOkResponse({ type: ClinicProfileDto })
  @ApiResponse({ status: 404, description: 'No active clinic with billing current for that slug' })
  async getBySlug(@Param('slug') slug: string): Promise<ClinicProfileDto> {
    return this.getClinicProfile.execute(slug);
  }
}

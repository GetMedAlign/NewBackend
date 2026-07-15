import {
  Controller,
  Get,
  NotFoundException,
  Param,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../../../infrastructure/security/roles.decorator';
import { RolesGuard } from '../../../../infrastructure/security/roles.guard';
import { CurrentUser } from '../../../../infrastructure/security/current-user.decorator';
import type { AuthenticatedUser } from '../../../../infrastructure/security/current-user.decorator';
import { GetApplicationUseCase } from '../../application/get-application.use-case';
import { ListApplicationsUseCase } from '../../application/list-applications.use-case';
import { ApplicationDetailDto } from './dto/application-detail.dto';
import { ApplicationSummaryDto } from './dto/application-summary.dto';

@ApiTags('Admin — Applications')
@ApiCookieAuth('access_token')
@Controller('admin/applications')
@Roles('admin', 'superadmin')
@UseGuards(RolesGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class AdminApplicationsController {
  constructor(
    private readonly listApplications: ListApplicationsUseCase,
    private readonly getApplication: GetApplicationUseCase,
  ) {}

  @ApiOperation({ summary: 'List all clinic applications (admin only)' })
  @Get()
  async list(@CurrentUser() user: AuthenticatedUser): Promise<ApplicationSummaryDto[]> {
    const results = await this.listApplications.execute({
      userId: user.sub,
      role: user.role,
    });
    return results.map((r) => {
      const dto = new ApplicationSummaryDto();
      dto.id = r.id;
      dto.clinicName = r.clinicName;
      dto.contactEmail = r.contactEmail;
      dto.city = r.city;
      dto.stateCode = r.stateCode;
      dto.status = r.status;
      dto.createdAt = r.createdAt;
      dto.reviewedAt = r.reviewedAt;
      return dto;
    });
  }

  @ApiOperation({ summary: 'Get a single clinic application by id (admin only)' })
  @Get(':id')
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ApplicationDetailDto> {
    const result = await this.getApplication.execute({ userId: user.sub, role: user.role }, id);
    if (!result) throw new NotFoundException('Application not found');

    const dto = new ApplicationDetailDto();
    dto.id = result.id;
    dto.clinicName = result.clinicName;
    dto.contactEmail = result.contactEmail;
    dto.businessEmail = result.businessEmail;
    dto.city = result.city;
    dto.stateCode = result.stateCode;
    dto.zipCode = result.zipCode;
    dto.websiteUrl = result.websiteUrl;
    dto.telehealthAvailable = result.telehealthAvailable;
    dto.offersLabWork = result.offersLabWork;
    dto.newPatientWait = result.newPatientWait;
    dto.npiNumber = result.npiNumber;
    dto.stateLicenseNumber = result.stateLicenseNumber;
    dto.consultationFeeBand = result.consultationFeeBand;
    dto.monthlyProgramBand = result.monthlyProgramBand;
    dto.financingAvailable = result.financingAvailable;
    dto.insuranceAccepted = result.insuranceAccepted;
    dto.insuranceNotes = result.insuranceNotes;
    dto.about = result.about;
    dto.differentiators = result.differentiators;
    dto.providerName = result.providerName;
    dto.credentials = result.credentials;
    dto.logoUrl = result.logoUrl;
    dto.photoUrls = result.photoUrls;
    dto.status = result.status;
    dto.createdAt = result.createdAt;
    dto.reviewedAt = result.reviewedAt;
    dto.categories = result.categories;
    dto.services = result.services.map((s) => ({
      serviceCode: s.serviceCode,
      isTopService: s.isTopService,
      displayOrder: s.displayOrder,
    }));
    return dto;
  }
}

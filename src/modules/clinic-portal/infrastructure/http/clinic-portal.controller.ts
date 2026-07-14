import {
  Controller,
  Get,
  Put,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClinicGuard } from '../../../../infrastructure/security/clinic.guard';
import { CurrentClinic } from '../../../../infrastructure/security/current-clinic.decorator';
import { GetClinicProfileUseCase } from '../../application/get-clinic-profile.use-case';
import { UpdateClinicProfileUseCase } from '../../application/update-clinic-profile.use-case';
import { ClinicPortalProfileDto, ServiceDto } from './dtos/clinic-portal-profile.dto';
import { UpdateClinicPortalProfileRequest } from './dtos/update-clinic-portal-profile.dto';
import type {
  ClinicProfileView,
  ClinicServiceView,
} from '../../domain/ports/clinic-write-repository.port';

const SPECIALTY_MAP: Record<string, string> = {
  hormone: 'Hormone Therapy',
  peptide: 'Peptide Therapy',
  med_spa: 'Med Spa & Aesthetics',
  wellness: 'Integrative Wellness',
};

function mapSpecialty(categories: string[]): string {
  if (categories.length === 0) return '';
  const first = categories[0]!;
  return SPECIALTY_MAP[first] ?? first;
}

function formatDate(date: Date | null): string | null {
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}

function toServiceDto(s: ClinicServiceView): ServiceDto {
  const dto = new ServiceDto();
  dto.serviceCode = s.serviceCode;
  dto.isTopService = s.isTopService;
  dto.displayOrder = s.displayOrder;
  return dto;
}

@ApiTags('Clinic Portal')
@ApiCookieAuth('access_token')
@Controller('clinic/portal')
@UseGuards(ClinicGuard)
export class ClinicPortalController {
  constructor(
    private readonly getProfileUseCase: GetClinicProfileUseCase,
    private readonly updateProfileUseCase: UpdateClinicProfileUseCase,
  ) {}

  @Get('profile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get the authenticated clinic profile' })
  async getClinicProfile(@CurrentClinic() clinicId: string): Promise<ClinicPortalProfileDto> {
    const profile: ClinicProfileView = await this.getProfileUseCase.execute(clinicId);

    const topServices = profile.services
      .filter((s) => s.isTopService)
      .sort((a, b) => a.displayOrder - b.displayOrder);

    const allServices = [...profile.services].sort((a, b) => {
      if (a.isTopService && !b.isTopService) return -1;
      if (!a.isTopService && b.isTopService) return 1;
      return a.displayOrder - b.displayOrder;
    });

    const dto = new ClinicPortalProfileDto();
    dto.id = profile.id;
    dto.slug = profile.slug;
    dto.name = profile.name;
    dto.about = profile.about;
    dto.providerName = profile.providerName;
    dto.websiteUrl = profile.websiteUrl;
    dto.city = profile.city;
    dto.stateCode = profile.stateCode;
    dto.location = profile.location;
    dto.businessEmail = profile.businessEmail;
    dto.webhookUrl = profile.webhookUrl;
    dto.webhookSecretConfigured = profile.webhookSecret !== null;
    dto.notifyOnLead = profile.notifyOnLead;
    dto.differentiators = profile.differentiators;
    dto.offersLabWork = profile.offersLabWork;
    dto.insuranceNotes = profile.insuranceNotes;
    dto.credentials = profile.credentials;
    dto.npiNumber = profile.npiNumber;
    dto.stateLicenseNumber = profile.stateLicenseNumber;
    dto.logoUrl = profile.logoUrl;
    dto.photoCount = profile.photoCount;
    dto.weeklySummary = profile.weeklySummary;
    dto.webhookHealth = profile.webhookHealth;
    dto.billingStatus = profile.billingStatus;
    dto.suspensionReason = profile.suspensionReason;
    dto.telehealthAvailable = profile.telehealthAvailable;
    dto.newPatientWait = profile.newPatientWait;
    dto.consultationFeeBand = profile.consultationFeeBand;
    dto.monthlyProgramBand = profile.monthlyProgramBand;
    dto.financingAvailable = profile.financingAvailable;
    dto.acceptsInsurance = profile.acceptsInsurance;
    dto.rating = profile.rating;
    dto.reviewCount = profile.reviewCount;
    dto.specialty = mapSpecialty(profile.treatmentCategories);
    dto.treatmentCategories = profile.treatmentCategories;
    dto.services = topServices.map(toServiceDto);
    dto.allServices = allServices.map(toServiceDto);
    dto.leadCount = profile.leadCount;
    dto.lastLeadAt = formatDate(profile.lastLeadAt);
    return dto;
  }

  @Put('profile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update the authenticated clinic profile' })
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true }))
  async updateClinicProfile(
    @CurrentClinic() clinicId: string,
    @Body() dto: UpdateClinicPortalProfileRequest,
  ): Promise<{ success: boolean }> {
    await this.updateProfileUseCase.execute(clinicId, {
      name: dto.name,
      about: dto.about,
      providerName: dto.providerName,
      websiteUrl: dto.websiteUrl,
      city: dto.city,
      stateCode: dto.stateCode,
      businessEmail: dto.businessEmail,
      webhookUrl: dto.webhookUrl,
      notifyOnLead: dto.notifyOnLead,
      differentiators: dto.differentiators,
      offersLabWork: dto.offersLabWork,
      insuranceNotes: dto.insuranceNotes,
      credentials: dto.credentials,
      npiNumber: dto.npiNumber,
      stateLicenseNumber: dto.stateLicenseNumber,
      weeklySummary: dto.weeklySummary,
      telehealthAvailable: dto.telehealthAvailable,
      newPatientWait: dto.newPatientWait,
      consultationFeeBand: dto.consultationFeeBand,
      monthlyProgramBand: dto.monthlyProgramBand,
      financingAvailable: dto.financingAvailable,
      acceptsInsurance: dto.acceptsInsurance,
      treatmentCategories: dto.treatmentCategories,
      topServices: dto.topServices,
      allServices: dto.allServices,
    });
    return { success: true };
  }
}

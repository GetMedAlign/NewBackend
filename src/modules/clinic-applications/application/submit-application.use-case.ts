import { Inject, Injectable } from '@nestjs/common';
import {
  APPLICATION_REPOSITORY,
  ApplicationRepositoryPort,
} from '../domain/ports/application-repository.port';
import type { SubmitApplicationDto } from '../infrastructure/http/dto/submit-application.dto';

export interface SubmitApplicationResult {
  applicationId: string;
}

@Injectable()
export class SubmitApplicationUseCase {
  constructor(@Inject(APPLICATION_REPOSITORY) private readonly repo: ApplicationRepositoryPort) {}

  async execute(dto: SubmitApplicationDto): Promise<SubmitApplicationResult> {
    return this.repo.create({
      clinicName: dto.clinicName,
      contactEmail: dto.contactEmail,
      businessEmail: dto.businessEmail,
      city: dto.city,
      stateCode: dto.stateCode,
      zipCode: dto.zipCode,
      websiteUrl: dto.websiteUrl,
      telehealthAvailable: dto.telehealthAvailable,
      offersLabWork: dto.offersLabWork,
      newPatientWait: dto.newPatientWait,
      npiNumber: dto.npiNumber,
      stateLicenseNumber: dto.stateLicenseNumber,
      consultationFeeBand: dto.consultationFeeBand,
      monthlyProgramBand: dto.monthlyProgramBand,
      financingAvailable: dto.financingAvailable,
      insuranceAccepted: dto.insuranceAccepted,
      insuranceNotes: dto.insuranceNotes,
      about: dto.about,
      differentiators: dto.differentiators,
      providerName: dto.providerName,
      credentials: dto.credentials,
      logoUrl: dto.logoUrl,
      photoUrls: dto.photoUrls,
      categories: dto.categories,
      services: dto.services.map((svc, idx) => ({
        serviceCode: svc.serviceCode,
        isTopService: svc.isTopService,
        displayOrder: idx + 1,
      })),
    });
  }
}

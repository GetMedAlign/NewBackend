import { Inject, Injectable } from '@nestjs/common';
import { CLINIC_REPOSITORY, ClinicRepositoryPort } from '../domain/ports/clinic-repository.port';
import { ClinicNotFoundError } from '../domain/errors/clinic-not-found.error';
import type { ClinicProfileDto } from '../domain/clinic-profile.dto';

const SPECIALTY_BY_CATEGORY: Record<string, string> = {
  hormone: 'Hormone Therapy',
  peptide: 'Peptide Therapy',
  med_spa: 'Med Spa & Aesthetics',
  wellness: 'Integrative Wellness',
};

@Injectable()
export class GetClinicProfileUseCase {
  constructor(@Inject(CLINIC_REPOSITORY) private readonly clinicRepo: ClinicRepositoryPort) {}

  /**
   * Orchestrates GET /clinics/:slug. Throws ClinicNotFoundError (mapped to
   * 404 by AllExceptionsFilter) when no active, billing-current clinic
   * matches the slug — the frontend's getClinicPublicProfile() already
   * catches any non-2xx response and renders its own not-found state.
   */
  async execute(slug: string): Promise<ClinicProfileDto> {
    const clinic = await this.clinicRepo.findProfileBySlug(slug);
    if (!clinic) {
      throw new ClinicNotFoundError(slug);
    }

    const location =
      clinic.location ??
      (clinic.city && clinic.stateCode
        ? `${clinic.city}, ${clinic.stateCode}`
        : (clinic.city ?? clinic.stateCode ?? ''));

    return {
      id: clinic.id,
      slug: clinic.slug,
      name: clinic.name,
      category: clinic.category,
      specialty: SPECIALTY_BY_CATEGORY[clinic.category] ?? clinic.category,
      location,
      city: clinic.city ?? '',
      stateCode: clinic.stateCode ?? '',
      zipCode: clinic.zipCode ?? '',
      rating: clinic.rating,
      reviewCount: clinic.reviewCount,
      about: clinic.about,
      differentiators: clinic.differentiators,
      services: clinic.topServices,
      allServices: clinic.allServices,
      waitTime: clinic.waitTime,
      telehealth: clinic.telehealthAvailable,
      offersLabWork: clinic.offersLabWork,
      websiteUrl: clinic.websiteUrl,
      consultationFee: clinic.consultationFeeBand,
      monthlyProgram: clinic.monthlyProgramBand,
      financing: clinic.financingAvailable,
      insurance: clinic.acceptsInsurance,
      providerName: clinic.providerName,
      credentials: clinic.credentials,
      photoCount: clinic.photoCount,
      logoUrl: clinic.logoUrl,
      photoUrls: clinic.photoUrls,
      tourVideoUrl: clinic.tourVideoUrl,
    };
  }
}

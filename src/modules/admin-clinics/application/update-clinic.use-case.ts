import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AdminCtx } from '../../../infrastructure/security/admin-ctx';
import { ADMIN_CLINIC_REPOSITORY } from '../domain/ports/admin-clinic-repository.port';
import type {
  AdminClinicRepositoryPort,
  UpdateClinicInput,
} from '../domain/ports/admin-clinic-repository.port';
import { isClinicStatus } from '../domain/clinic-dto.mapper';

/**
 * Strips a field from a partial input when its value is undefined or null,
 * matching "absent or null leaves the column unchanged" semantics (spec §1.2).
 */
function present<T>(value: T | null | undefined): value is T {
  return value !== undefined && value !== null;
}

@Injectable()
export class UpdateClinicUseCase {
  constructor(
    @Inject(ADMIN_CLINIC_REPOSITORY)
    private readonly repo: AdminClinicRepositoryPort,
  ) {}

  async execute(ctx: AdminCtx, clinicId: string, input: UpdateClinicInput): Promise<void> {
    const sanitized: UpdateClinicInput = {};

    if (present(input.name)) sanitized.name = input.name;
    // An unrecognized status is silently ignored (.NET Enum.TryParse guard,
    // spec §1.2) rather than rejected — do not throw here.
    if (present(input.status) && isClinicStatus(input.status)) sanitized.status = input.status;
    if (present(input.about)) sanitized.about = input.about;
    if (present(input.differentiators)) sanitized.differentiators = input.differentiators;
    if (present(input.providerName)) sanitized.providerName = input.providerName;
    if (present(input.credentials)) sanitized.credentials = input.credentials;
    if (present(input.websiteUrl)) sanitized.websiteUrl = input.websiteUrl;
    if (present(input.city)) sanitized.city = input.city;
    if (present(input.stateCode)) sanitized.stateCode = input.stateCode;
    if (present(input.zipCode)) sanitized.zipCode = input.zipCode;
    if (present(input.telehealth)) sanitized.telehealth = input.telehealth;
    if (present(input.offersLabWork)) sanitized.offersLabWork = input.offersLabWork;
    if (present(input.financing)) sanitized.financing = input.financing;
    if (present(input.insurance)) sanitized.insurance = input.insurance;
    if (present(input.insuranceNotes)) sanitized.insuranceNotes = input.insuranceNotes;
    if (present(input.consultationFee)) sanitized.consultationFee = input.consultationFee;
    if (present(input.monthlyProgram)) sanitized.monthlyProgram = input.monthlyProgram;
    if (present(input.waitTime)) sanitized.waitTime = input.waitTime;
    if (present(input.rating)) sanitized.rating = input.rating;
    if (present(input.reviewCount)) sanitized.reviewCount = input.reviewCount;
    if (present(input.isListedInDirectory)) {
      sanitized.isListedInDirectory = input.isListedInDirectory;
    }
    if (present(input.logoUrl)) sanitized.logoUrl = input.logoUrl;

    const found = await this.repo.updateClinic(ctx, clinicId, sanitized);
    if (!found) throw new NotFoundException('Clinic not found.');
  }
}

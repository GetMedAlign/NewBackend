import { NotFoundException } from '@nestjs/common';
import { GetClinicProfileUseCase } from '../get-clinic-profile.use-case';
import type {
  ClinicWriteRepositoryPort,
  ClinicProfileView,
} from '../../domain/ports/clinic-write-repository.port';

const CLINIC_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function makeProfile(overrides: Partial<ClinicProfileView> = {}): ClinicProfileView {
  return {
    id: CLINIC_ID,
    slug: 'test-clinic',
    name: 'Test Clinic',
    about: null,
    providerName: null,
    websiteUrl: null,
    city: 'New York',
    stateCode: 'NY',
    zipCode: '10001',
    location: 'New York, NY',
    businessEmail: null,
    webhookUrl: null,
    webhookSecret: null,
    notifyOnLead: false,
    differentiators: null,
    offersLabWork: false,
    insuranceNotes: null,
    credentials: null,
    npiNumber: null,
    stateLicenseNumber: null,
    logoUrl: null,
    photoCount: 0,
    weeklySummary: false,
    webhookHealth: 'unknown',
    billingStatus: 'active',
    suspensionReason: null,
    telehealthAvailable: false,
    newPatientWait: null,
    consultationFeeBand: null,
    monthlyProgramBand: null,
    financingAvailable: false,
    acceptsInsurance: false,
    rating: 4.5,
    reviewCount: 10,
    treatmentCategories: ['hormone'],
    services: [],
    leadCount: 0,
    lastLeadAt: null,
    ...overrides,
  };
}

function makeRepo(profile: ClinicProfileView | null): ClinicWriteRepositoryPort {
  return {
    findProfile: jest.fn().mockResolvedValue(profile),
    updateProfile: jest.fn().mockResolvedValue(undefined),
  };
}

describe('GetClinicProfileUseCase', () => {
  it('returns the profile when found', async () => {
    const profile = makeProfile();
    const repo = makeRepo(profile);
    const useCase = new GetClinicProfileUseCase(repo);

    const result = await useCase.execute(CLINIC_ID);

    expect(result).toBe(profile);
    expect(result.zipCode).toBe('10001');
    expect(repo.findProfile).toHaveBeenCalledWith(CLINIC_ID);
  });

  it('throws NotFoundException when clinic is not found', async () => {
    const repo = makeRepo(null);
    const useCase = new GetClinicProfileUseCase(repo);

    await expect(useCase.execute(CLINIC_ID)).rejects.toThrow(NotFoundException);
  });

  it('propagates repository errors', async () => {
    const repo: ClinicWriteRepositoryPort = {
      findProfile: jest.fn().mockRejectedValue(new Error('DB error')),
      updateProfile: jest.fn(),
    };
    const useCase = new GetClinicProfileUseCase(repo);

    await expect(useCase.execute(CLINIC_ID)).rejects.toThrow('DB error');
  });
});

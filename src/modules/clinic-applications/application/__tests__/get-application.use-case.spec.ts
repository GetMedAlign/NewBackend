import { Test } from '@nestjs/testing';
import { GetApplicationUseCase } from '../get-application.use-case';
import { APPLICATION_REPOSITORY } from '../../domain/ports/application-repository.port';
import type {
  ApplicationRepositoryPort,
  ApplicationDetail,
} from '../../domain/ports/application-repository.port';

const now = new Date('2025-01-15T10:00:00Z');

const fakeDetail: ApplicationDetail = {
  id: 'aaa-111',
  clinicName: 'Horizon Hormone Health',
  contactEmail: 'apply@horizon.example.com',
  businessEmail: 'biz@horizon.example.com',
  city: 'Austin',
  stateCode: 'TX',
  zipCode: '78701',
  websiteUrl: 'https://horizon.example.com',
  telehealthAvailable: true,
  offersLabWork: false,
  newPatientWait: '2-3 weeks',
  npiNumber: '1234567890',
  stateLicenseNumber: 'TX-001',
  consultationFeeBand: '$100-$200',
  monthlyProgramBand: '$300-$500',
  financingAvailable: true,
  insuranceAccepted: false,
  insuranceNotes: 'HSA accepted',
  about: 'We specialize in hormone health.',
  differentiators: 'Best in class.',
  providerName: 'Dr. Smith',
  credentials: 'MD',
  logoUrl: 'https://storage.test/logo.png',
  photoUrls: ['https://storage.test/photo1.jpg'],
  status: 'pending',
  createdAt: now,
  reviewedAt: null,
  categories: ['hormone', 'peptide'],
  services: [
    { serviceCode: 'testosterone-replacement', isTopService: true, displayOrder: 1 },
    { serviceCode: 'peptide-therapy', isTopService: false, displayOrder: 2 },
  ],
};

describe('GetApplicationUseCase', () => {
  let useCase: GetApplicationUseCase;
  let mockRepo: jest.Mocked<ApplicationRepositoryPort>;

  beforeEach(async () => {
    mockRepo = {
      create: jest.fn(),
      list: jest.fn(),
      findById: jest.fn().mockResolvedValue(fakeDetail),
    };

    const module = await Test.createTestingModule({
      providers: [GetApplicationUseCase, { provide: APPLICATION_REPOSITORY, useValue: mockRepo }],
    }).compile();

    useCase = module.get(GetApplicationUseCase);
  });

  it('delegates to repo.findById with the provided ctx and id', async () => {
    const ctx = { userId: 'admin-123', role: 'admin' };
    await useCase.execute(ctx, 'aaa-111');
    expect(mockRepo.findById).toHaveBeenCalledWith(
      { userId: 'admin-123', role: 'admin' },
      'aaa-111',
    );
  });

  it('returns the detail from repo.findById', async () => {
    const result = await useCase.execute({ userId: 'admin-123', role: 'admin' }, 'aaa-111');
    expect(result).toEqual(fakeDetail);
  });

  it('passes through all scalar fields', async () => {
    const result = await useCase.execute({ userId: 'admin-123', role: 'admin' }, 'aaa-111');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('aaa-111');
    expect(result!.clinicName).toBe('Horizon Hormone Health');
    expect(result!.businessEmail).toBe('biz@horizon.example.com');
    expect(result!.telehealthAvailable).toBe(true);
    expect(result!.financingAvailable).toBe(true);
    expect(result!.insuranceAccepted).toBe(false);
    expect(result!.status).toBe('pending');
    expect(result!.createdAt).toEqual(now);
    expect(result!.reviewedAt).toBeNull();
  });

  it('passes through categories as string array', async () => {
    const result = await useCase.execute({ userId: 'admin-123', role: 'admin' }, 'aaa-111');
    expect(result!.categories).toEqual(['hormone', 'peptide']);
  });

  it('passes through services sorted by displayOrder', async () => {
    const result = await useCase.execute({ userId: 'admin-123', role: 'admin' }, 'aaa-111');
    expect(result!.services).toHaveLength(2);
    expect(result!.services[0]!.serviceCode).toBe('testosterone-replacement');
    expect(result!.services[0]!.isTopService).toBe(true);
    expect(result!.services[0]!.displayOrder).toBe(1);
    expect(result!.services[1]!.serviceCode).toBe('peptide-therapy');
    expect(result!.services[1]!.isTopService).toBe(false);
    expect(result!.services[1]!.displayOrder).toBe(2);
  });

  it('returns null when repo returns null', async () => {
    mockRepo.findById.mockResolvedValue(null);
    const result = await useCase.execute({ userId: 'admin-123', role: 'admin' }, 'nonexistent-id');
    expect(result).toBeNull();
  });
});

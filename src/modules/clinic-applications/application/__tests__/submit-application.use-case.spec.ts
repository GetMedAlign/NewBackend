import { Test } from '@nestjs/testing';
import { SubmitApplicationUseCase } from '../submit-application.use-case';
import { APPLICATION_REPOSITORY } from '../../domain/ports/application-repository.port';
import type {
  ApplicationRepositoryPort,
  SubmitApplicationInput,
} from '../../domain/ports/application-repository.port';
import type { SubmitApplicationDto } from '../../infrastructure/http/dto/submit-application.dto';

describe('SubmitApplicationUseCase', () => {
  let useCase: SubmitApplicationUseCase;
  let mockRepo: jest.Mocked<ApplicationRepositoryPort>;

  beforeEach(async () => {
    mockRepo = {
      create: jest.fn().mockResolvedValue({ applicationId: 'test-app-id-123' }),
      list: jest.fn(),
      findById: jest.fn(),
      approve: jest.fn(),
      deny: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        SubmitApplicationUseCase,
        { provide: APPLICATION_REPOSITORY, useValue: mockRepo },
      ],
    }).compile();

    useCase = module.get(SubmitApplicationUseCase);
  });

  const baseDto: SubmitApplicationDto = {
    clinicName: 'Test Clinic',
    contactEmail: 'test@example.com',
    categories: ['hormone', 'peptide'],
    services: [
      { serviceCode: 'testosterone-replacement', isTopService: true },
      { serviceCode: 'peptide-therapy', isTopService: false },
    ],
  };

  it('returns { applicationId } from the repository', async () => {
    const result = await useCase.execute(baseDto);
    expect(result).toEqual({ applicationId: 'test-app-id-123' });
  });

  it('calls repo.create once', async () => {
    await useCase.execute(baseDto);
    expect(mockRepo.create).toHaveBeenCalledTimes(1);
  });

  it('maps clinicName and contactEmail to repo input', async () => {
    await useCase.execute(baseDto);
    const input: SubmitApplicationInput = mockRepo.create.mock.calls[0]![0];
    expect(input.clinicName).toBe('Test Clinic');
    expect(input.contactEmail).toBe('test@example.com');
  });

  it('maps categories array through to repo input', async () => {
    await useCase.execute(baseDto);
    const input: SubmitApplicationInput = mockRepo.create.mock.calls[0]![0];
    expect(input.categories).toEqual(['hormone', 'peptide']);
  });

  it('maps services with correct serviceCode and isTopService', async () => {
    await useCase.execute(baseDto);
    const input: SubmitApplicationInput = mockRepo.create.mock.calls[0]![0];
    expect(input.services).toHaveLength(2);
    expect(input.services[0]!.serviceCode).toBe('testosterone-replacement');
    expect(input.services[0]!.isTopService).toBe(true);
    expect(input.services[1]!.serviceCode).toBe('peptide-therapy');
    expect(input.services[1]!.isTopService).toBe(false);
  });

  it('assigns display_order based on array index (1-based)', async () => {
    await useCase.execute({
      ...baseDto,
      services: [
        { serviceCode: 'svc-a', isTopService: true },
        { serviceCode: 'svc-b', isTopService: false },
        { serviceCode: 'svc-c', isTopService: false },
      ],
    });
    const input: SubmitApplicationInput = mockRepo.create.mock.calls[0]![0];
    expect(input.services[0]!.displayOrder).toBe(1);
    expect(input.services[1]!.displayOrder).toBe(2);
    expect(input.services[2]!.displayOrder).toBe(3);
  });

  it('maps optional fields when provided', async () => {
    await useCase.execute({
      ...baseDto,
      businessEmail: 'biz@example.com',
      city: 'Austin',
      stateCode: 'TX',
      zipCode: '78701',
      websiteUrl: 'https://example.com',
      telehealthAvailable: true,
      offersLabWork: true,
      newPatientWait: '1-2 weeks',
      npiNumber: '1234567890',
      stateLicenseNumber: 'TX-001',
      consultationFeeBand: '$100-$200',
      monthlyProgramBand: '$200-$400',
      financingAvailable: false,
      insuranceAccepted: false,
      insuranceNotes: null,
      about: 'About text',
      differentiators: 'Key differentiators',
      providerName: 'Dr. Voss',
      credentials: 'MD',
      logoUrl: 'https://storage.test/logo.png',
      photoUrls: ['https://storage.test/photo1.jpg'],
    });
    const input: SubmitApplicationInput = mockRepo.create.mock.calls[0]![0];
    expect(input.businessEmail).toBe('biz@example.com');
    expect(input.city).toBe('Austin');
    expect(input.stateCode).toBe('TX');
    expect(input.zipCode).toBe('78701');
    expect(input.websiteUrl).toBe('https://example.com');
    expect(input.telehealthAvailable).toBe(true);
    expect(input.offersLabWork).toBe(true);
    expect(input.newPatientWait).toBe('1-2 weeks');
    expect(input.npiNumber).toBe('1234567890');
    expect(input.stateLicenseNumber).toBe('TX-001');
    expect(input.consultationFeeBand).toBe('$100-$200');
    expect(input.monthlyProgramBand).toBe('$200-$400');
    expect(input.financingAvailable).toBe(false);
    expect(input.insuranceAccepted).toBe(false);
    expect(input.insuranceNotes).toBeNull();
    expect(input.about).toBe('About text');
    expect(input.differentiators).toBe('Key differentiators');
    expect(input.providerName).toBe('Dr. Voss');
    expect(input.credentials).toBe('MD');
    expect(input.logoUrl).toBe('https://storage.test/logo.png');
    expect(input.photoUrls).toEqual(['https://storage.test/photo1.jpg']);
  });

  it('passes undefined optional fields as undefined', async () => {
    await useCase.execute(baseDto);
    const input: SubmitApplicationInput = mockRepo.create.mock.calls[0]![0];
    expect(input.businessEmail).toBeUndefined();
    expect(input.city).toBeUndefined();
    expect(input.logoUrl).toBeUndefined();
    expect(input.photoUrls).toBeUndefined();
  });
});

import { Test } from '@nestjs/testing';
import { ListApplicationsUseCase } from '../list-applications.use-case';
import { APPLICATION_REPOSITORY } from '../../domain/ports/application-repository.port';
import type {
  ApplicationRepositoryPort,
  ApplicationSummary,
} from '../../domain/ports/application-repository.port';

const now = new Date('2025-01-15T10:00:00Z');

const fakeSummaries: ApplicationSummary[] = [
  {
    id: 'aaa-111',
    clinicName: 'Horizon Hormone Health',
    contactEmail: 'apply@horizon.example.com',
    city: 'Austin',
    stateCode: 'TX',
    status: 'pending',
    createdAt: now,
    reviewedAt: null,
  },
  {
    id: 'bbb-222',
    clinicName: 'Apex Peptide',
    contactEmail: 'apply@apex.example.com',
    city: null,
    stateCode: null,
    status: 'approved',
    createdAt: new Date('2025-01-10T08:00:00Z'),
    reviewedAt: new Date('2025-01-12T09:00:00Z'),
  },
];

describe('ListApplicationsUseCase', () => {
  let useCase: ListApplicationsUseCase;
  let mockRepo: jest.Mocked<ApplicationRepositoryPort>;

  beforeEach(async () => {
    mockRepo = {
      create: jest.fn(),
      list: jest.fn().mockResolvedValue(fakeSummaries),
      findById: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [ListApplicationsUseCase, { provide: APPLICATION_REPOSITORY, useValue: mockRepo }],
    }).compile();

    useCase = module.get(ListApplicationsUseCase);
  });

  it('delegates to repo.list with the provided ctx', async () => {
    const ctx = { userId: 'admin-123', role: 'admin' };
    await useCase.execute(ctx);
    expect(mockRepo.list).toHaveBeenCalledWith({ userId: 'admin-123', role: 'admin' });
  });

  it('returns the array from repo.list', async () => {
    const result = await useCase.execute({ userId: 'admin-123', role: 'admin' });
    expect(result).toEqual(fakeSummaries);
    expect(result).toHaveLength(2);
  });

  it('passes through summary fields correctly', async () => {
    const result = await useCase.execute({ userId: 'admin-123', role: 'admin' });
    const first = result[0]!;
    expect(first.id).toBe('aaa-111');
    expect(first.clinicName).toBe('Horizon Hormone Health');
    expect(first.contactEmail).toBe('apply@horizon.example.com');
    expect(first.city).toBe('Austin');
    expect(first.stateCode).toBe('TX');
    expect(first.status).toBe('pending');
    expect(first.createdAt).toEqual(now);
    expect(first.reviewedAt).toBeNull();
  });

  it('passes through null city/stateCode correctly', async () => {
    const result = await useCase.execute({ userId: 'admin-123', role: 'admin' });
    const second = result[1]!;
    expect(second.city).toBeNull();
    expect(second.stateCode).toBeNull();
    expect(second.reviewedAt).toBeInstanceOf(Date);
  });

  it('returns empty array when repo returns empty', async () => {
    mockRepo.list.mockResolvedValue([]);
    const result = await useCase.execute({ userId: 'admin-123', role: 'admin' });
    expect(result).toEqual([]);
  });
});

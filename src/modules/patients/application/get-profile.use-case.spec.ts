import { NotFoundException } from '@nestjs/common';
import { GetProfileUseCase } from './get-profile.use-case';
import type {
  PatientRepositoryPort,
  PatientProfile,
} from '../domain/ports/patient-repository.port';
import { PatientNotFoundError } from '../domain/errors/patient-not-found.error';
import { PATIENT_REPOSITORY } from '../domain/ports/patient-repository.port';

function makeRepo(profile: PatientProfile | null): PatientRepositoryPort {
  return {
    findProfile: jest.fn().mockResolvedValue(profile),
    updateProfile: jest.fn().mockResolvedValue(undefined),
  };
}

// Direct construction bypassing DI for unit tests
function buildUseCase(repo: PatientRepositoryPort): GetProfileUseCase {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const uc = new (GetProfileUseCase as any)(repo) as GetProfileUseCase;
  return uc;
}

describe('GetProfileUseCase', () => {
  it('returns name empty string, dob null, zipCode null when no patient row (hasPatient=false)', async () => {
    const repo = makeRepo({
      name: null,
      email: 'user@example.com',
      dob: null,
      zipCode: null,
      isDeleted: false,
      hasPatient: false,
    });
    const uc = buildUseCase(repo);
    const result = await uc.execute('user-id');
    expect(result).toEqual({
      name: '',
      email: 'user@example.com',
      dob: null,
      zipCode: null,
    });
  });

  it('returns actual name when set', async () => {
    const repo = makeRepo({
      name: 'Alice Smith',
      email: 'alice@example.com',
      dob: null,
      zipCode: null,
      isDeleted: false,
      hasPatient: false,
    });
    const uc = buildUseCase(repo);
    const result = await uc.execute('user-id');
    expect(result.name).toBe('Alice Smith');
  });

  it('formats dob as yyyy-MM-dd', async () => {
    // Use local-time constructor to avoid UTC/local timezone offset issues
    const dob = new Date(1990, 4, 15); // May 15, 1990 in local time
    const repo = makeRepo({
      name: null,
      email: 'dob@example.com',
      dob,
      zipCode: null,
      isDeleted: false,
      hasPatient: true,
    });
    const uc = buildUseCase(repo);
    const result = await uc.execute('user-id');
    expect(result.dob).toBe('1990-05-15');
  });

  it('throws PatientNotFoundError when hasPatient=true and isDeleted=true', async () => {
    const repo = makeRepo({
      name: null,
      email: 'deleted@example.com',
      dob: null,
      zipCode: null,
      isDeleted: true,
      hasPatient: true,
    });
    const uc = buildUseCase(repo);
    await expect(uc.execute('user-id')).rejects.toThrow(PatientNotFoundError);
  });

  it('throws NotFoundException when profile is null (user not found)', async () => {
    const repo = makeRepo(null);
    const uc = buildUseCase(repo);
    await expect(uc.execute('user-id')).rejects.toThrow(NotFoundException);
  });

  it('returns zipCode when present', async () => {
    const repo = makeRepo({
      name: null,
      email: 'zip@example.com',
      dob: null,
      zipCode: '10001',
      isDeleted: false,
      hasPatient: true,
    });
    const uc = buildUseCase(repo);
    const result = await uc.execute('user-id');
    expect(result.zipCode).toBe('10001');
  });
});

// Verify PATIENT_REPOSITORY token is exported
describe('PATIENT_REPOSITORY token', () => {
  it('is a Symbol', () => {
    expect(typeof PATIENT_REPOSITORY).toBe('symbol');
  });
});

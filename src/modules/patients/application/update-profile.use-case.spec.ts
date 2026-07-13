import { UpdateProfileUseCase } from './update-profile.use-case';
import type {
  PatientRepositoryPort,
  PatientProfile,
} from '../domain/ports/patient-repository.port';
import { PatientNotFoundError } from '../domain/errors/patient-not-found.error';

function makeRepo(
  profile: PatientProfile | null,
): PatientRepositoryPort & { updateProfile: jest.Mock } {
  return {
    findProfile: jest.fn().mockResolvedValue(profile),
    updateProfile: jest.fn().mockResolvedValue(undefined),
  };
}

function buildUseCase(repo: PatientRepositoryPort): UpdateProfileUseCase {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new (UpdateProfileUseCase as any)(repo) as UpdateProfileUseCase;
}

describe('UpdateProfileUseCase', () => {
  it('calls updateProfile with name when no dob provided', async () => {
    const repo = makeRepo({
      name: null,
      email: 'user@example.com',
      dob: null,
      zipCode: null,
      isDeleted: false,
      hasPatient: true,
    });
    const uc = buildUseCase(repo);
    await uc.execute('user-id', { name: 'Alice' });
    expect(repo.updateProfile).toHaveBeenCalledWith('user-id', { name: 'Alice' });
  });

  it('calls updateProfile with name and dob when dob provided', async () => {
    const repo = makeRepo({
      name: null,
      email: 'user@example.com',
      dob: null,
      zipCode: null,
      isDeleted: false,
      hasPatient: true,
    });
    const uc = buildUseCase(repo);
    await uc.execute('user-id', { name: 'Alice', dob: '1990-01-01' });
    expect(repo.updateProfile).toHaveBeenCalledWith('user-id', {
      name: 'Alice',
      dob: '1990-01-01',
    });
  });

  it('throws PatientNotFoundError when patient is deleted', async () => {
    const repo = makeRepo({
      name: null,
      email: 'deleted@example.com',
      dob: null,
      zipCode: null,
      isDeleted: true,
      hasPatient: true,
    });
    const uc = buildUseCase(repo);
    await expect(uc.execute('user-id', { name: 'Alice' })).rejects.toThrow(PatientNotFoundError);
    expect(repo.updateProfile).not.toHaveBeenCalled();
  });

  it('calls updateProfile even when profile is null (no patient row)', async () => {
    const repo = makeRepo(null);
    const uc = buildUseCase(repo);
    await uc.execute('user-id', { name: 'Alice' });
    expect(repo.updateProfile).toHaveBeenCalledWith('user-id', { name: 'Alice' });
  });

  it('calls updateProfile when hasPatient=false (user without patient)', async () => {
    const repo = makeRepo({
      name: null,
      email: 'nop@example.com',
      dob: null,
      zipCode: null,
      isDeleted: false,
      hasPatient: false,
    });
    const uc = buildUseCase(repo);
    await uc.execute('user-id', { name: 'Bob' });
    expect(repo.updateProfile).toHaveBeenCalledWith('user-id', { name: 'Bob' });
  });
});

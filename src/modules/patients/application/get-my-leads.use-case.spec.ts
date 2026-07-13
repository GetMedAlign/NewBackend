import { GetMyLeadsUseCase } from './get-my-leads.use-case';
import type {
  PatientRepositoryPort,
  PatientProfile,
} from '../domain/ports/patient-repository.port';
import type {
  LeadRepositoryPort,
  PatientLeadView,
} from '../../leads/domain/ports/lead-repository.port';

const SAMPLE_LEAD: PatientLeadView = {
  leadId: 'lead_abc123',
  clinicId: 'clinic-uuid',
  clinicName: 'Vitality Hormone NYC',
  clinicSlug: 'vitality-hormone-nyc',
  clinicCategory: 'hormone',
  websiteUrl: 'https://vitality.example.com',
  submittedAt: new Date('2026-01-01T00:00:00Z'),
  treatmentCategory: 'hormone',
  topGoals: ['boost_energy', 'lose_weight'],
  topSymptoms: ['fatigue'],
  budgetBand: '200_500',
  telehealthPreference: 'yes',
  startTimeline: null,
  appointmentPreference: null,
};

function makePatientRepo(profile: PatientProfile | null): PatientRepositoryPort {
  return {
    findProfile: jest.fn().mockResolvedValue(profile),
    updateProfile: jest.fn().mockResolvedValue(undefined),
  };
}

function makeLeadRepo(leads: PatientLeadView[]): LeadRepositoryPort {
  return {
    create: jest.fn(),
    recordDelivery: jest.fn(),
    setDeliveryStatus: jest.fn(),
    findByPatientUser: jest.fn().mockResolvedValue(leads),
  };
}

function buildUseCase(
  leadRepo: LeadRepositoryPort,
  patientRepo: PatientRepositoryPort,
): GetMyLeadsUseCase {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new (GetMyLeadsUseCase as any)(leadRepo, patientRepo) as GetMyLeadsUseCase;
}

describe('GetMyLeadsUseCase', () => {
  it('returns [] when no patient row (profile is null)', async () => {
    const leadRepo = makeLeadRepo([SAMPLE_LEAD]);
    const patientRepo = makePatientRepo(null);
    const uc = buildUseCase(leadRepo, patientRepo);
    const result = await uc.execute('user-id');
    expect(result).toEqual([]);
    expect(leadRepo.findByPatientUser).not.toHaveBeenCalled();
  });

  it('returns [] when profile.hasPatient is false', async () => {
    const leadRepo = makeLeadRepo([SAMPLE_LEAD]);
    const patientRepo = makePatientRepo({
      name: null,
      email: 'user@example.com',
      dob: null,
      zipCode: null,
      isDeleted: false,
      hasPatient: false,
    });
    const uc = buildUseCase(leadRepo, patientRepo);
    const result = await uc.execute('user-id');
    expect(result).toEqual([]);
  });

  it('returns [] when isDeleted=true', async () => {
    const leadRepo = makeLeadRepo([SAMPLE_LEAD]);
    const patientRepo = makePatientRepo({
      name: null,
      email: 'deleted@example.com',
      dob: null,
      zipCode: null,
      isDeleted: true,
      hasPatient: true,
    });
    const uc = buildUseCase(leadRepo, patientRepo);
    const result = await uc.execute('user-id');
    expect(result).toEqual([]);
  });

  it('returns leads from findByPatientUser when patient exists and not deleted', async () => {
    const leadRepo = makeLeadRepo([SAMPLE_LEAD]);
    const patientRepo = makePatientRepo({
      name: 'Alice',
      email: 'alice@example.com',
      dob: null,
      zipCode: null,
      isDeleted: false,
      hasPatient: true,
    });
    const uc = buildUseCase(leadRepo, patientRepo);
    const result = await uc.execute('user-id');
    expect(result).toHaveLength(1);
    expect(result[0].leadId).toBe('lead_abc123');
    expect(leadRepo.findByPatientUser).toHaveBeenCalledWith('user-id');
  });

  it('each lead has topGoals as string[] and clinicCategory with fallback', async () => {
    const leadWithFallback: PatientLeadView = {
      ...SAMPLE_LEAD,
      topGoals: ['goal_a', 'goal_b'],
      topSymptoms: [],
      clinicCategory: 'hormone',
    };
    const leadRepo = makeLeadRepo([leadWithFallback]);
    const patientRepo = makePatientRepo({
      name: null,
      email: 'user@example.com',
      dob: null,
      zipCode: null,
      isDeleted: false,
      hasPatient: true,
    });
    const uc = buildUseCase(leadRepo, patientRepo);
    const result = await uc.execute('user-id');
    expect(Array.isArray(result[0].topGoals)).toBe(true);
    expect(result[0].topGoals).toEqual(['goal_a', 'goal_b']);
    expect(result[0].clinicCategory).toBe('hormone');
  });
});

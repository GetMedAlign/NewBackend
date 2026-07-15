/**
 * Unit tests for clinic lead DTO mapping, status validation, and contact-request use case.
 */
import { NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { toClinicLeadDto } from '../../infrastructure/http/dtos/clinic-lead.dto';
import { UpdateLeadStatusUseCase } from '../update-lead-status.use-case';
import { GetClinicLeadUseCase } from '../get-clinic-lead.use-case';
import { RequestPatientContactUseCase } from '../request-patient-contact.use-case';
import type { ClinicLeadView } from '../../domain/ports/clinic-lead-repository.port';
import type { ClinicLeadRepositoryPort } from '../../domain/ports/clinic-lead-repository.port';
import type { EmailSenderPort } from '../../../auth/infrastructure/adapters/email-sender.port';

const CLINIC_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const LEAD_ID = 'lead-abc-123';

function makeLeadView(overrides: Partial<ClinicLeadView> = {}): ClinicLeadView {
  return {
    id: 'uuid-001',
    leadId: LEAD_ID,
    receivedAt: new Date('2026-01-15T10:00:00.000Z'),
    leadSource: 'assessment',
    patientFirstName: 'Jane',
    patientEmail: 'jane@example.com',
    patientZip: '10001',
    treatmentCategory: 'hormone',
    topGoals: 'energy,weight loss,mood',
    topSymptoms: 'fatigue,brain fog',
    budgetBand: '$100-200/mo',
    telehealthPreference: 'yes',
    startTimeline: 'immediately',
    deliveryStatus: 'delivered',
    clinicStatus: 'new',
    clinicId: CLINIC_ID,
    clinicName: 'Vitality Clinic',
    clinicWebsiteUrl: 'https://vitality.example.com',
    ...overrides,
  };
}

// -------------------------------------------------------------------------
// DTO mapping
// -------------------------------------------------------------------------

describe('toClinicLeadDto — DTO mapping', () => {
  it('maps all snake_case outer fields correctly', () => {
    const dto = toClinicLeadDto(makeLeadView());

    expect(dto.lead_id).toBe(LEAD_ID);
    expect(dto.received_at).toBe('2026-01-15T10:00:00.000Z');
    expect(dto.lead_source).toBe('assessment');
    expect(dto.delivery_status).toBe('delivered');
    expect(dto.clinic_status).toBe('new');
  });

  it('maps patient sub-object with snake_case keys', () => {
    const dto = toClinicLeadDto(makeLeadView());

    expect(dto.patient.first_name).toBe('Jane');
    expect(dto.patient.email).toBe('jane@example.com');
    expect(dto.patient.zip_code).toBe('10001');
  });

  it('maps assessment_summary with camelCase inner keys', () => {
    const dto = toClinicLeadDto(makeLeadView());

    expect(dto.assessment_summary.treatmentCategory).toBe('hormone');
    expect(dto.assessment_summary.topGoals).toEqual(['energy', 'weight loss', 'mood']);
    expect(dto.assessment_summary.topSymptoms).toEqual(['fatigue', 'brain fog']);
    expect(dto.assessment_summary.budgetBand).toBe('$100-200/mo');
    expect(dto.assessment_summary.telehealthPreference).toBe('yes');
    expect(dto.assessment_summary.startTimeline).toBe('immediately');
  });

  it('splits comma-joined goals and drops empty entries', () => {
    const dto = toClinicLeadDto(makeLeadView({ topGoals: 'energy,,weight loss, ,mood' }));

    expect(dto.assessment_summary.topGoals).toEqual(['energy', 'weight loss', 'mood']);
  });

  it('returns empty arrays when topGoals/topSymptoms are null', () => {
    const dto = toClinicLeadDto(makeLeadView({ topGoals: null, topSymptoms: null }));

    expect(dto.assessment_summary.topGoals).toEqual([]);
    expect(dto.assessment_summary.topSymptoms).toEqual([]);
  });

  it('returns null zip_code when patientZip is null', () => {
    const dto = toClinicLeadDto(makeLeadView({ patientZip: null }));

    expect(dto.patient.zip_code).toBeNull();
  });

  it('produces ISO-8601 received_at string', () => {
    const date = new Date('2026-03-01T09:30:00.000Z');
    const dto = toClinicLeadDto(makeLeadView({ receivedAt: date }));

    expect(dto.received_at).toBe('2026-03-01T09:30:00.000Z');
  });
});

// -------------------------------------------------------------------------
// Status validation (UpdateLeadStatusUseCase)
// -------------------------------------------------------------------------

describe('UpdateLeadStatusUseCase', () => {
  function makeRepo(updated: boolean): ClinicLeadRepositoryPort {
    return {
      listByClinic: jest.fn(),
      findByClinic: jest.fn(),
      updateStatus: jest.fn().mockResolvedValue(updated),
    };
  }

  it('resolves successfully when repo returns true', async () => {
    const repo = makeRepo(true);
    const useCase = new UpdateLeadStatusUseCase(repo);

    await expect(useCase.execute(CLINIC_ID, LEAD_ID, 'contacted')).resolves.toBeUndefined();
    expect(repo.updateStatus).toHaveBeenCalledWith(CLINIC_ID, LEAD_ID, 'contacted');
  });

  it('throws NotFoundException when repo returns false (lead not found / not owned)', async () => {
    const repo = makeRepo(false);
    const useCase = new UpdateLeadStatusUseCase(repo);

    await expect(useCase.execute(CLINIC_ID, LEAD_ID, 'booked')).rejects.toThrow(NotFoundException);
  });

  it('propagates repo errors', async () => {
    const repo: ClinicLeadRepositoryPort = {
      listByClinic: jest.fn(),
      findByClinic: jest.fn(),
      updateStatus: jest.fn().mockRejectedValue(new Error('DB down')),
    };
    const useCase = new UpdateLeadStatusUseCase(repo);

    await expect(useCase.execute(CLINIC_ID, LEAD_ID, 'new')).rejects.toThrow('DB down');
  });
});

// -------------------------------------------------------------------------
// GetClinicLeadUseCase
// -------------------------------------------------------------------------

describe('GetClinicLeadUseCase', () => {
  it('returns the lead when found', async () => {
    const lead = makeLeadView();
    const repo: ClinicLeadRepositoryPort = {
      listByClinic: jest.fn(),
      findByClinic: jest.fn().mockResolvedValue(lead),
      updateStatus: jest.fn(),
    };
    const useCase = new GetClinicLeadUseCase(repo);

    const result = await useCase.execute(CLINIC_ID, LEAD_ID);
    expect(result).toBe(lead);
  });

  it('throws NotFoundException when lead is not found', async () => {
    const repo: ClinicLeadRepositoryPort = {
      listByClinic: jest.fn(),
      findByClinic: jest.fn().mockResolvedValue(null),
      updateStatus: jest.fn(),
    };
    const useCase = new GetClinicLeadUseCase(repo);

    await expect(useCase.execute(CLINIC_ID, LEAD_ID)).rejects.toThrow(NotFoundException);
  });
});

// -------------------------------------------------------------------------
// RequestPatientContactUseCase
// -------------------------------------------------------------------------

describe('RequestPatientContactUseCase', () => {
  function makeEmailSender(shouldThrow = false): EmailSenderPort {
    return {
      send: shouldThrow
        ? jest.fn().mockRejectedValue(new Error('SMTP error'))
        : jest.fn().mockResolvedValue(undefined),
    };
  }

  function makeRepo(lead: ClinicLeadView | null): ClinicLeadRepositoryPort {
    return {
      listByClinic: jest.fn(),
      findByClinic: jest.fn().mockResolvedValue(lead),
      updateStatus: jest.fn(),
    };
  }

  it('sends email to patient email address with clinic name, website, and patient first name', async () => {
    const lead = makeLeadView();
    const emailSender = makeEmailSender();
    const repo = makeRepo(lead);
    const useCase = new RequestPatientContactUseCase(repo, emailSender);

    await useCase.execute(CLINIC_ID, LEAD_ID);

    expect(emailSender.send).toHaveBeenCalledTimes(1);
    const [to, subject, body] = (emailSender.send as jest.Mock).mock.calls[0] as [
      string,
      string,
      string,
    ];
    expect(to).toBe('jane@example.com');
    expect(subject).toContain('Vitality Clinic');
    expect(body).toContain('Jane');
    expect(body).toContain('Vitality Clinic');
    expect(body).toContain('https://vitality.example.com');
  });

  it('includes clinic name in subject even without website', async () => {
    const lead = makeLeadView({ clinicWebsiteUrl: null });
    const emailSender = makeEmailSender();
    const repo = makeRepo(lead);
    const useCase = new RequestPatientContactUseCase(repo, emailSender);

    await useCase.execute(CLINIC_ID, LEAD_ID);

    const [, subject, body] = (emailSender.send as jest.Mock).mock.calls[0] as [
      string,
      string,
      string,
    ];
    expect(subject).toContain('Vitality Clinic');
    // No website in body when null
    expect(body).not.toContain('https://');
  });

  it('throws NotFoundException when lead not found', async () => {
    const repo = makeRepo(null);
    const emailSender = makeEmailSender();
    const useCase = new RequestPatientContactUseCase(repo, emailSender);

    await expect(useCase.execute(CLINIC_ID, LEAD_ID)).rejects.toThrow(NotFoundException);
    expect(emailSender.send).not.toHaveBeenCalled();
  });

  it('throws InternalServerErrorException when email sender throws', async () => {
    const lead = makeLeadView();
    const emailSender = makeEmailSender(true);
    const repo = makeRepo(lead);
    const useCase = new RequestPatientContactUseCase(repo, emailSender);

    await expect(useCase.execute(CLINIC_ID, LEAD_ID)).rejects.toThrow(InternalServerErrorException);
  });
});

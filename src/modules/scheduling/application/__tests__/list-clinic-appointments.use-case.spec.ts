import { ListClinicAppointmentsUseCase } from '../list-clinic-appointments.use-case';
import type {
  AppointmentRecord,
  AppointmentRepositoryPort,
} from '../../domain/ports/appointment-repository.port';

const CLINIC_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const OTHER_CLINIC_ID = 'ffffffff-1111-2222-3333-444444444444';

function makeAppointment(overrides: Partial<AppointmentRecord> = {}): AppointmentRecord {
  return {
    id: 'appt_1',
    clinicId: CLINIC_ID,
    clinicName: 'Acme Clinic',
    leadId: 'lead_abc123',
    patientId: 'patient_1',
    sessionId: null,
    inviteeEmail: 'invitee@example.com',
    inviteeName: 'Jane Doe',
    calendlyEventUri: 'https://api.calendly.com/scheduled_events/abc',
    calendlyInviteeUri: 'https://api.calendly.com/scheduled_events/abc/invitees/def',
    startTime: new Date('2026-08-20T15:00:00.000Z'),
    endTime: new Date('2026-08-20T15:30:00.000Z'),
    status: 'booked',
    createdAt: new Date('2026-08-10T00:00:00.000Z'),
    updatedAt: new Date('2026-08-10T00:00:00.000Z'),
    ...overrides,
  };
}

function makeRepo(overrides: Partial<AppointmentRepositoryPort> = {}): AppointmentRepositoryPort {
  return {
    createIfAbsent: jest.fn(),
    cancelByInviteeUri: jest.fn(),
    findLeadIdByInviteeUri: jest.fn(),
    listForClinic: jest.fn().mockResolvedValue([]),
    listForPatient: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('ListClinicAppointmentsUseCase', () => {
  it('maps repository rows to the client-safe DTO shape', async () => {
    const repo = makeRepo({
      listForClinic: jest.fn().mockResolvedValue([makeAppointment()]),
    });
    const useCase = new ListClinicAppointmentsUseCase(repo);

    const result = await useCase.execute(CLINIC_ID);

    expect(result).toEqual([
      {
        id: 'appt_1',
        status: 'booked',
        startTime: '2026-08-20T15:00:00.000Z',
        endTime: '2026-08-20T15:30:00.000Z',
        inviteeName: 'Jane Doe',
        inviteeEmail: 'invitee@example.com',
        clinicId: CLINIC_ID,
        clinicName: 'Acme Clinic',
        leadId: 'lead_abc123',
      },
    ]);
  });

  it('passes only the caller clinicId through to the repository', async () => {
    const listForClinic = jest.fn().mockResolvedValue([]);
    const repo = makeRepo({ listForClinic });
    const useCase = new ListClinicAppointmentsUseCase(repo);

    await useCase.execute(CLINIC_ID);

    expect(listForClinic).toHaveBeenCalledTimes(1);
    expect(listForClinic).toHaveBeenCalledWith(CLINIC_ID);
    expect(listForClinic).not.toHaveBeenCalledWith(OTHER_CLINIC_ID);
  });

  it('returns an empty array when the clinic has no appointments', async () => {
    const repo = makeRepo({ listForClinic: jest.fn().mockResolvedValue([]) });
    const useCase = new ListClinicAppointmentsUseCase(repo);

    const result = await useCase.execute(CLINIC_ID);

    expect(result).toEqual([]);
  });

  it('never includes Calendly URIs, patientId, or sessionId in the returned shape', async () => {
    const repo = makeRepo({
      listForClinic: jest.fn().mockResolvedValue([makeAppointment()]),
    });
    const useCase = new ListClinicAppointmentsUseCase(repo);

    const result = await useCase.execute(CLINIC_ID);

    expect(Object.keys(result[0]).sort()).toEqual(
      [
        'clinicId',
        'clinicName',
        'endTime',
        'id',
        'inviteeEmail',
        'inviteeName',
        'leadId',
        'startTime',
        'status',
      ].sort(),
    );
  });

  it('maps a null endTime and leadId through as null', async () => {
    const repo = makeRepo({
      listForClinic: jest.fn().mockResolvedValue([makeAppointment({ endTime: null, leadId: null })]),
    });
    const useCase = new ListClinicAppointmentsUseCase(repo);

    const result = await useCase.execute(CLINIC_ID);

    expect(result[0].endTime).toBeNull();
    expect(result[0].leadId).toBeNull();
  });
});

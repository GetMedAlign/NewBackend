import { ListPatientAppointmentsUseCase } from '../list-patient-appointments.use-case';
import type {
  AppointmentRecord,
  AppointmentRepositoryPort,
} from '../../domain/ports/appointment-repository.port';

const PATIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const OTHER_PATIENT_ID = 'ffffffff-1111-2222-3333-444444444444';

function makeAppointment(overrides: Partial<AppointmentRecord> = {}): AppointmentRecord {
  return {
    id: 'appt_1',
    clinicId: 'clinic_1',
    clinicName: 'Acme Clinic',
    leadId: 'lead_abc123',
    patientId: PATIENT_ID,
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

describe('ListPatientAppointmentsUseCase', () => {
  it('maps repository rows to the client-safe DTO shape', async () => {
    const repo = makeRepo({
      listForPatient: jest.fn().mockResolvedValue([makeAppointment()]),
    });
    const useCase = new ListPatientAppointmentsUseCase(repo);

    const result = await useCase.execute({ patientId: PATIENT_ID, sessionId: '' });

    expect(result).toEqual([
      {
        id: 'appt_1',
        status: 'booked',
        startTime: '2026-08-20T15:00:00.000Z',
        endTime: '2026-08-20T15:30:00.000Z',
        inviteeName: 'Jane Doe',
        inviteeEmail: 'invitee@example.com',
        clinicId: 'clinic_1',
        clinicName: 'Acme Clinic',
        leadId: 'lead_abc123',
      },
    ]);
  });

  it('passes only the caller patientId and sessionId through to the repository', async () => {
    const listForPatient = jest.fn().mockResolvedValue([]);
    const repo = makeRepo({ listForPatient });
    const useCase = new ListPatientAppointmentsUseCase(repo);

    await useCase.execute({ patientId: PATIENT_ID, sessionId: 'session_abc' });

    expect(listForPatient).toHaveBeenCalledTimes(1);
    expect(listForPatient).toHaveBeenCalledWith({ patientId: PATIENT_ID, sessionId: 'session_abc' });
    expect(listForPatient).not.toHaveBeenCalledWith(
      expect.objectContaining({ patientId: OTHER_PATIENT_ID }),
    );
  });

  it('returns an empty array when the patient has no appointments', async () => {
    const repo = makeRepo({ listForPatient: jest.fn().mockResolvedValue([]) });
    const useCase = new ListPatientAppointmentsUseCase(repo);

    const result = await useCase.execute({ patientId: PATIENT_ID, sessionId: '' });

    expect(result).toEqual([]);
  });

  it('never includes Calendly URIs, patientId, or sessionId in the returned shape', async () => {
    const repo = makeRepo({
      listForPatient: jest.fn().mockResolvedValue([makeAppointment()]),
    });
    const useCase = new ListPatientAppointmentsUseCase(repo);

    const result = await useCase.execute({ patientId: PATIENT_ID, sessionId: '' });

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
});

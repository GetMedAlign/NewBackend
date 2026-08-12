import { HandleCalendlyWebhookUseCase } from '../handle-calendly-webhook.use-case';
import type { SchedulingRepositoryPort } from '../../domain/ports/scheduling-repository.port';
import type { CalendlyWebhookVerifierPort } from '../../domain/ports/calendly-webhook-verifier.port';
import type { AppointmentRepositoryPort } from '../../domain/ports/appointment-repository.port';
import type { EncryptionPort } from '../../../auth/domain/ports/encryption.port';
import type { LeadRepositoryPort } from '../../../leads/domain/ports/lead-repository.port';

const CLINIC_ID = 'clinic-123';
const OTHER_CLINIC_ID = 'clinic-999';
const SIGNING_KEY_ENCRYPTED = 'enc(signing-key)';
const SIGNING_KEY = 'signing-key';

/** Round-trips `enc(<plaintext>)` so tests can assert on ciphertext without real crypto. */
function makeEncryption(overrides: Partial<EncryptionPort> = {}): jest.Mocked<EncryptionPort> {
  return {
    encrypt: jest.fn((plaintext: string) => `enc(${plaintext})`),
    decrypt: jest.fn((ciphertext: string) => {
      if (!ciphertext.startsWith('enc(') || !ciphertext.endsWith(')')) {
        throw new Error('bad ciphertext');
      }
      return ciphertext.slice(4, -1);
    }),
    ...overrides,
  } as jest.Mocked<EncryptionPort>;
}

function makeSchedulingRepo(
  overrides: Partial<SchedulingRepositoryPort> = {},
): jest.Mocked<SchedulingRepositoryPort> {
  return {
    getSchedulingState: jest.fn(),
    setCalendlyConnection: jest.fn(),
    clearScheduling: jest.fn(),
    getWebhookVerificationState: jest
      .fn()
      .mockResolvedValue({ provider: 'calendly', signingKeyEncrypted: SIGNING_KEY_ENCRYPTED }),
    ...overrides,
  } as jest.Mocked<SchedulingRepositoryPort>;
}

function makeVerifier(overrides: Partial<CalendlyWebhookVerifierPort> = {}): jest.Mocked<CalendlyWebhookVerifierPort> {
  return {
    verify: jest.fn(),
    ...overrides,
  } as jest.Mocked<CalendlyWebhookVerifierPort>;
}

function makeAppointments(
  overrides: Partial<AppointmentRepositoryPort> = {},
): jest.Mocked<AppointmentRepositoryPort> {
  return {
    createIfAbsent: jest.fn().mockResolvedValue(undefined),
    cancelByInviteeUri: jest.fn().mockResolvedValue(null),
    hasOtherBookedAppointment: jest.fn().mockResolvedValue(false),
    listForClinic: jest.fn().mockResolvedValue([]),
    listForPatient: jest.fn().mockResolvedValue([]),
    ...overrides,
  } as jest.Mocked<AppointmentRepositoryPort>;
}

function makeLeads(overrides: Partial<LeadRepositoryPort> = {}): jest.Mocked<LeadRepositoryPort> {
  return {
    create: jest.fn(),
    recordDelivery: jest.fn(),
    setDeliveryStatus: jest.fn(),
    findByPatientUser: jest.fn(),
    setBookedScheduled: jest.fn().mockResolvedValue(undefined),
    revertBooking: jest.fn().mockResolvedValue(undefined),
    findLatestByClinicAndEmail: jest.fn().mockResolvedValue(null),
    findPatientIdByLeadId: jest.fn().mockResolvedValue(null),
    ...overrides,
  } as jest.Mocked<LeadRepositoryPort>;
}

function inviteeCreatedBody(overrides: {
  uri?: string;
  email?: string;
  utmContent?: string | null;
} = {}): Buffer {
  return Buffer.from(
    JSON.stringify({
      event: 'invitee.created',
      payload: {
        email: overrides.email ?? 'patient@example.com',
        name: 'Jane Doe',
        uri: overrides.uri ?? 'https://api.calendly.com/invitees/invitee-1',
        tracking: { utm_content: overrides.utmContent },
        scheduled_event: {
          uri: 'https://api.calendly.com/scheduled_events/event-1',
          start_time: '2026-08-20T15:00:00.000000Z',
          end_time: '2026-08-20T15:30:00.000000Z',
        },
      },
    }),
  );
}

function inviteeCanceledBody(overrides: { uri?: string; utmContent?: string | null } = {}): Buffer {
  return Buffer.from(
    JSON.stringify({
      event: 'invitee.canceled',
      payload: {
        email: 'patient@example.com',
        uri: overrides.uri ?? 'https://api.calendly.com/invitees/invitee-1',
        tracking: { utm_content: overrides.utmContent },
      },
    }),
  );
}

function makeUseCase(deps: {
  schedulingRepo?: jest.Mocked<SchedulingRepositoryPort>;
  verifier?: jest.Mocked<CalendlyWebhookVerifierPort>;
  appointments?: jest.Mocked<AppointmentRepositoryPort>;
  encryption?: jest.Mocked<EncryptionPort>;
  leads?: jest.Mocked<LeadRepositoryPort>;
} = {}): {
  useCase: HandleCalendlyWebhookUseCase;
  schedulingRepo: jest.Mocked<SchedulingRepositoryPort>;
  verifier: jest.Mocked<CalendlyWebhookVerifierPort>;
  appointments: jest.Mocked<AppointmentRepositoryPort>;
  encryption: jest.Mocked<EncryptionPort>;
  leads: jest.Mocked<LeadRepositoryPort>;
} {
  const schedulingRepo = deps.schedulingRepo ?? makeSchedulingRepo();
  const verifier = deps.verifier ?? makeVerifier();
  const appointments = deps.appointments ?? makeAppointments();
  const encryption = deps.encryption ?? makeEncryption();
  const leads = deps.leads ?? makeLeads();

  const useCase = new HandleCalendlyWebhookUseCase(
    schedulingRepo,
    verifier,
    appointments,
    encryption,
    leads,
  );

  return { useCase, schedulingRepo, verifier, appointments, encryption, leads };
}

describe('HandleCalendlyWebhookUseCase', () => {
  it('creates the appointment and books the lead for invitee.created with a valid tracking token', async () => {
    const { useCase, verifier, appointments, leads } = makeUseCase({
      leads: makeLeads({ findPatientIdByLeadId: jest.fn().mockResolvedValue(null) }),
    });
    const token = `enc(lead_abc:${CLINIC_ID})`;

    await useCase.handle(CLINIC_ID, inviteeCreatedBody({ utmContent: token }), 'sig');

    expect(verifier.verify).toHaveBeenCalledWith(expect.any(Buffer), 'sig', SIGNING_KEY);
    expect(appointments.createIfAbsent).toHaveBeenCalledWith({
      clinicId: CLINIC_ID,
      leadId: 'lead_abc',
      patientId: null,
      inviteeEmail: 'patient@example.com',
      inviteeName: 'Jane Doe',
      calendlyEventUri: 'https://api.calendly.com/scheduled_events/event-1',
      calendlyInviteeUri: 'https://api.calendly.com/invitees/invitee-1',
      startTime: new Date('2026-08-20T15:00:00.000000Z'),
      endTime: new Date('2026-08-20T15:30:00.000000Z'),
      status: 'booked',
    });
    expect(leads.setBookedScheduled).toHaveBeenCalledWith(
      'lead_abc',
      new Date('2026-08-20T15:00:00.000000Z'),
    );
  });

  it('includes the resolved patientId on the appointment when the lead has one', async () => {
    const { useCase, appointments, leads } = makeUseCase({
      leads: makeLeads({ findPatientIdByLeadId: jest.fn().mockResolvedValue('patient-xyz') }),
    });
    const token = `enc(lead_abc:${CLINIC_ID})`;

    await useCase.handle(CLINIC_ID, inviteeCreatedBody({ utmContent: token }), 'sig');

    expect(leads.findPatientIdByLeadId).toHaveBeenCalledWith('lead_abc');
    expect(appointments.createIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: 'lead_abc', patientId: 'patient-xyz' }),
    );
  });

  it('falls back to clinic + email lookup when the tracking token is absent', async () => {
    const { useCase, appointments, leads } = makeUseCase({
      leads: makeLeads({ findLatestByClinicAndEmail: jest.fn().mockResolvedValue({ leadId: 'lead_fallback' }) }),
    });

    await useCase.handle(CLINIC_ID, inviteeCreatedBody({ utmContent: undefined }), 'sig');

    expect(leads.findLatestByClinicAndEmail).toHaveBeenCalledWith(CLINIC_ID, 'patient@example.com');
    expect(appointments.createIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: 'lead_fallback' }),
    );
    expect(leads.setBookedScheduled).toHaveBeenCalledWith('lead_fallback', expect.any(Date));
  });

  it('falls back to email lookup when the tracking token resolves to a different clinic', async () => {
    const { useCase, appointments, leads } = makeUseCase({
      leads: makeLeads({ findLatestByClinicAndEmail: jest.fn().mockResolvedValue({ leadId: 'lead_fallback' }) }),
    });
    const token = `enc(lead_other:${OTHER_CLINIC_ID})`;

    await useCase.handle(CLINIC_ID, inviteeCreatedBody({ utmContent: token }), 'sig');

    expect(leads.findLatestByClinicAndEmail).toHaveBeenCalledWith(CLINIC_ID, 'patient@example.com');
    expect(appointments.createIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: 'lead_fallback' }),
    );
  });

  it('leaves the lead and patientId unset when neither the token nor an email match resolves one', async () => {
    const { useCase, appointments, leads } = makeUseCase();

    await useCase.handle(CLINIC_ID, inviteeCreatedBody({ utmContent: undefined }), 'sig');

    expect(leads.findPatientIdByLeadId).not.toHaveBeenCalled();
    expect(appointments.createIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: null, patientId: null }),
    );
    expect(leads.setBookedScheduled).not.toHaveBeenCalled();
  });

  it('is idempotent across redelivery: createIfAbsent is called again without throwing', async () => {
    const { useCase, appointments } = makeUseCase();
    const body = inviteeCreatedBody({ utmContent: `enc(lead_abc:${CLINIC_ID})` });

    await useCase.handle(CLINIC_ID, body, 'sig');
    await expect(useCase.handle(CLINIC_ID, body, 'sig')).resolves.toBeUndefined();

    expect(appointments.createIfAbsent).toHaveBeenCalledTimes(2);
  });

  it('cancels the appointment and reverts the lead for invitee.canceled, scoped to the clinic', async () => {
    const { useCase, appointments, leads } = makeUseCase({
      appointments: makeAppointments({ cancelByInviteeUri: jest.fn().mockResolvedValue('lead_abc') }),
    });
    const token = `enc(lead_abc:${CLINIC_ID})`;

    await useCase.handle(CLINIC_ID, inviteeCanceledBody({ utmContent: token }), 'sig');

    expect(appointments.cancelByInviteeUri).toHaveBeenCalledWith(
      CLINIC_ID,
      'https://api.calendly.com/invitees/invitee-1',
    );
    expect(leads.revertBooking).toHaveBeenCalledWith('lead_abc');
  });

  it('cancels and reverts for invitee.canceled even with no tracking token, using the leadId the scoped cancel returns', async () => {
    const { useCase, appointments, leads } = makeUseCase({
      appointments: makeAppointments({ cancelByInviteeUri: jest.fn().mockResolvedValue('lead_linked') }),
    });

    await useCase.handle(CLINIC_ID, inviteeCanceledBody({ utmContent: undefined }), 'sig');

    expect(appointments.cancelByInviteeUri).toHaveBeenCalledWith(
      CLINIC_ID,
      'https://api.calendly.com/invitees/invitee-1',
    );
    expect(leads.revertBooking).toHaveBeenCalledWith('lead_linked');
  });

  it('does not cancel or revert clinic B data when the invitee URI belongs to a different clinic (tenant isolation)', async () => {
    // The repo's scoped cancelByInviteeUri only matches (clinicId,
    // calendlyInviteeUri) together, so an invitee URI owned by clinic B
    // returns null when a validly-signed webhook for clinic A tries to
    // cancel it, even if the (forged/stale) tracking token claims clinic A.
    const { useCase, appointments, leads } = makeUseCase({
      appointments: makeAppointments({ cancelByInviteeUri: jest.fn().mockResolvedValue(null) }),
    });
    const tokenForOtherClinic = `enc(lead_b:${OTHER_CLINIC_ID})`;

    await useCase.handle(CLINIC_ID, inviteeCanceledBody({ utmContent: tokenForOtherClinic }), 'sig');

    expect(appointments.cancelByInviteeUri).toHaveBeenCalledWith(
      CLINIC_ID,
      'https://api.calendly.com/invitees/invitee-1',
    );
    expect(leads.revertBooking).not.toHaveBeenCalled();
    expect(appointments.hasOtherBookedAppointment).not.toHaveBeenCalled();
  });

  it('does not revert the lead on cancel when it has another booked appointment (Calendly reschedule)', async () => {
    // Calendly reschedules fire invitee.created (new invitee URI, same
    // lead) then invitee.canceled (old invitee URI): the lead is still
    // booked via the new appointment, so the old one canceling must not
    // revert it back to 'contacted'.
    const { useCase, appointments, leads } = makeUseCase({
      appointments: makeAppointments({
        cancelByInviteeUri: jest.fn().mockResolvedValue('lead_abc'),
        hasOtherBookedAppointment: jest.fn().mockResolvedValue(true),
      }),
    });

    await useCase.handle(CLINIC_ID, inviteeCanceledBody({ utmContent: undefined }), 'sig');

    expect(appointments.hasOtherBookedAppointment).toHaveBeenCalledWith(
      CLINIC_ID,
      'lead_abc',
      'https://api.calendly.com/invitees/invitee-1',
    );
    expect(leads.revertBooking).not.toHaveBeenCalled();
  });

  it('reverts the lead on cancel when it has no other booked appointment', async () => {
    const { useCase, leads } = makeUseCase({
      appointments: makeAppointments({
        cancelByInviteeUri: jest.fn().mockResolvedValue('lead_abc'),
        hasOtherBookedAppointment: jest.fn().mockResolvedValue(false),
      }),
    });

    await useCase.handle(CLINIC_ID, inviteeCanceledBody({ utmContent: undefined }), 'sig');

    expect(leads.revertBooking).toHaveBeenCalledWith('lead_abc');
  });

  it('propagates a bad-signature failure from the verifier without touching any repo', async () => {
    const throwingVerifier = makeVerifier({
      verify: jest.fn(() => {
        throw new Error('signature mismatch');
      }),
    });
    const { useCase, appointments, leads } = makeUseCase({ verifier: throwingVerifier });

    await expect(useCase.handle(CLINIC_ID, inviteeCreatedBody(), 'bad-sig')).rejects.toThrow(
      'signature mismatch',
    );
    expect(appointments.createIfAbsent).not.toHaveBeenCalled();
    expect(appointments.cancelByInviteeUri).not.toHaveBeenCalled();
    expect(leads.setBookedScheduled).not.toHaveBeenCalled();
    expect(leads.revertBooking).not.toHaveBeenCalled();
  });

  it('ignores the webhook and writes nothing when the clinic is not connected to Calendly', async () => {
    const { useCase, verifier, appointments, leads } = makeUseCase({
      schedulingRepo: makeSchedulingRepo({
        getWebhookVerificationState: jest.fn().mockResolvedValue({ provider: 'none', signingKeyEncrypted: null }),
      }),
    });

    await expect(useCase.handle(CLINIC_ID, inviteeCreatedBody(), 'sig')).resolves.toBeUndefined();

    expect(verifier.verify).not.toHaveBeenCalled();
    expect(appointments.createIfAbsent).not.toHaveBeenCalled();
    expect(leads.setBookedScheduled).not.toHaveBeenCalled();
  });

  it('ignores the webhook when connected but the signing key is missing', async () => {
    const { useCase, verifier, appointments } = makeUseCase({
      schedulingRepo: makeSchedulingRepo({
        getWebhookVerificationState: jest
          .fn()
          .mockResolvedValue({ provider: 'calendly', signingKeyEncrypted: null }),
      }),
    });

    await expect(useCase.handle(CLINIC_ID, inviteeCreatedBody(), 'sig')).resolves.toBeUndefined();

    expect(verifier.verify).not.toHaveBeenCalled();
    expect(appointments.createIfAbsent).not.toHaveBeenCalled();
  });

  it('ignores unhandled event types without writing anything', async () => {
    const { useCase, appointments, leads } = makeUseCase();
    const body = Buffer.from(JSON.stringify({ event: 'invitee_no_show.created', payload: { uri: 'x' } }));

    await expect(useCase.handle(CLINIC_ID, body, 'sig')).resolves.toBeUndefined();

    expect(appointments.createIfAbsent).not.toHaveBeenCalled();
    expect(appointments.cancelByInviteeUri).not.toHaveBeenCalled();
    expect(leads.setBookedScheduled).not.toHaveBeenCalled();
    expect(leads.revertBooking).not.toHaveBeenCalled();
  });
});

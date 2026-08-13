import { PatientAppointmentsController } from '../patient-appointments.controller';
import type { AuthenticatedUser } from '../../../../../infrastructure/security/current-user.decorator';
import type { PatientRepositoryPort } from '../../../../patients/domain/ports/patient-repository.port';
import type { ListPatientAppointmentsUseCase } from '../../../application/list-patient-appointments.use-case';
import type { PrepareBookingUseCase } from '../../../application/prepare-booking.use-case';

const USER_ID = 'user_1';
const PATIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return { sub: USER_ID, role: 'patient', clinicId: null, ...overrides };
}

function makePrepareBookingUseCase(): PrepareBookingUseCase {
  return { execute: jest.fn() } as unknown as PrepareBookingUseCase;
}

describe('PatientAppointmentsController', () => {
  it('resolves the caller patientId from the session and passes it to the use case', async () => {
    const patientRepository: Pick<PatientRepositoryPort, 'findPatientIdByUserId'> = {
      findPatientIdByUserId: jest.fn().mockResolvedValue(PATIENT_ID),
    };
    const execute = jest.fn().mockResolvedValue([]);
    const useCase = { execute } as unknown as ListPatientAppointmentsUseCase;
    const controller = new PatientAppointmentsController(
      patientRepository as PatientRepositoryPort,
      useCase,
      makePrepareBookingUseCase(),
    );

    await controller.getMyAppointments(makeUser());

    expect(patientRepository.findPatientIdByUserId).toHaveBeenCalledWith(USER_ID);
    expect(execute).toHaveBeenCalledWith({ patientId: PATIENT_ID, sessionId: '' });
  });

  it('returns an empty array without calling the use case when the caller has no patient record', async () => {
    const patientRepository: Pick<PatientRepositoryPort, 'findPatientIdByUserId'> = {
      findPatientIdByUserId: jest.fn().mockResolvedValue(null),
    };
    const execute = jest.fn();
    const useCase = { execute } as unknown as ListPatientAppointmentsUseCase;
    const controller = new PatientAppointmentsController(
      patientRepository as PatientRepositoryPort,
      useCase,
      makePrepareBookingUseCase(),
    );

    const result = await controller.getMyAppointments(makeUser());

    expect(result).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it('delegates booking context to PrepareBookingUseCase with the caller userId and slug', async () => {
    const patientRepository = {} as PatientRepositoryPort;
    const listUseCase = {} as ListPatientAppointmentsUseCase;
    const bookingContext = {
      provider: 'calendly' as const,
      schedulingUrl: 'https://calendly.com/acme/consult',
      trackingToken: 'ciphertext',
      inviteeName: 'Jane Doe',
      inviteeEmail: 'jane@example.com',
    };
    const execute = jest.fn().mockResolvedValue(bookingContext);
    const prepareBookingUseCase = { execute } as unknown as PrepareBookingUseCase;
    const controller = new PatientAppointmentsController(
      patientRepository,
      listUseCase,
      prepareBookingUseCase,
    );

    const result = await controller.getBookingContext(makeUser(), 'acme-clinic');

    expect(execute).toHaveBeenCalledWith({ userId: USER_ID, slug: 'acme-clinic' });
    expect(result).toBe(bookingContext);
  });
});

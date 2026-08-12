import { PatientAppointmentsController } from '../patient-appointments.controller';
import type { AuthenticatedUser } from '../../../../../infrastructure/security/current-user.decorator';
import type { PatientRepositoryPort } from '../../../../patients/domain/ports/patient-repository.port';
import type { ListPatientAppointmentsUseCase } from '../../../application/list-patient-appointments.use-case';

const USER_ID = 'user_1';
const PATIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return { sub: USER_ID, role: 'patient', clinicId: null, ...overrides };
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
    );

    const result = await controller.getMyAppointments(makeUser());

    expect(result).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });
});

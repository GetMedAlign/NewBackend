export interface PatientProfile {
  name: string | null;
  email: string;
  dob: Date | null;
  zipCode: string | null;
  isDeleted: boolean;
  hasPatient: boolean;
}

export interface PatientRepositoryPort {
  findProfile(userId: string): Promise<PatientProfile | null>;
  updateProfile(userId: string, data: { name: string; dob?: string }): Promise<void>;
}

export const PATIENT_REPOSITORY = Symbol('PatientRepositoryPort');

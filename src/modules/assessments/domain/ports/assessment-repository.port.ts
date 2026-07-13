import type { Assessment } from '../assessment.entity';

export interface AssessmentCreateInput {
  treatmentCategory: string;
  selectedGoals: string[];
  selectedSymptoms: string[];
  symptomSeverities: Record<string, number>;
  symptomDuration?: string | null;
  hasPriorTreatment?: boolean | null;
  exerciseFrequency?: string | null;
  diet?: string | null;
  sleepHours?: string | null;
  stressLevel?: string | null;
  alcoholUse?: string | null;
  willingLabWork?: boolean | null;
  willingStructuredProgram?: boolean | null;
  appointmentPreference?: string | null;
  startTimeline?: string | null;
  budgetBand: string;
  telehealthPreference: string;
  biologicalSex?: string | null;
  pregnantOrPlanning?: boolean | null;
  takingPrescriptions?: boolean | null;
  hadPriorTherapy?: boolean | null;
  medicationAllergies?: boolean | null;
  allergyDetails?: string | null;
  chronicConditions: string[];
  currentPrescriptions: string[];
  otherMedications?: string | null;
  zipCode: string;
  consentGiven: boolean;
  consentVersion: string;
}

export interface AssessmentRepositoryPort {
  create(
    data: AssessmentCreateInput,
    ctx: { userId?: string },
  ): Promise<{ id: string; sessionId: string }>;
  findBySessionId(sessionId: string): Promise<Assessment | null>;
  findLatestByPatientUser(userId: string): Promise<Assessment | null>;
  linkToPatient(sessionId: string, userId: string): Promise<void>;
}

export const ASSESSMENT_REPOSITORY = Symbol('AssessmentRepositoryPort');

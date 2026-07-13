/**
 * Response DTO matching the .NET LatestAssessmentDto field names.
 * All fields are plain (no class-validator decorators needed for output).
 */
export class LatestAssessmentResponseDto {
  sessionId!: string;
  treatmentCategory!: string;
  selectedGoals!: string[];
  selectedSymptoms!: string[];
  symptomSeverities!: Record<string, number>;
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
  budgetBand!: string;
  telehealthPreference!: string;
  biologicalSex?: string | null;
  pregnantOrPlanning?: boolean | null;
  takingPrescriptions?: boolean | null;
  hadPriorTherapy?: boolean | null;
  medicationAllergies?: boolean | null;
  allergyDetails?: string | null;
  chronicConditions!: string[];
  currentPrescriptions!: string[];
  otherMedications?: string | null;
  zipCode!: string;
}

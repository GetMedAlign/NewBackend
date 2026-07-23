import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ArrayMaxSize,
  ValidateIf,
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';

export enum TreatmentCategoryEnum {
  hormone = 'hormone',
  peptide = 'peptide',
  med_spa = 'med_spa',
  wellness = 'wellness',
}

export enum BudgetBandEnum {
  '100_200' = '100_200',
  '200_500' = '200_500',
  '500_1k' = '500_1k',
  '1k_plus' = '1k_plus',
  unknown = 'unknown',
}

export enum TelehealthPreferenceEnum {
  yes = 'yes',
  no = 'no',
  either = 'either',
}

/** Custom validator: all values in a Record<string, number> must be 1–5 */
function IsSymptomSeverities(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isSymptomSeverities',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
          const rec = value as Record<string, unknown>;
          return Object.values(rec).every(
            (v) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5,
          );
        },
        defaultMessage(): string {
          return 'symptomSeverities values must be integers between 1 and 5';
        },
      },
    });
  };
}

/**
 * Cross-field validator: every symptom code in `selectedSymptoms` must have
 * a corresponding severity (1-5) in `symptomSeverities`.
 */
function EachSymptomHasSeverity(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'eachSymptomHasSeverity',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          if (!Array.isArray(value)) return true; // let @IsArray handle it
          const dto = args.object as SubmitAssessmentDto;
          const severities = dto.symptomSeverities;
          if (typeof severities !== 'object' || severities === null) return false;
          return (value as string[]).every(
            (code) =>
              Object.prototype.hasOwnProperty.call(severities, code) &&
              typeof severities[code] === 'number' &&
              Number.isInteger(severities[code]) &&
              severities[code] >= 1 &&
              severities[code] <= 5,
          );
        },
        defaultMessage(): string {
          return 'every entry in selectedSymptoms must have a corresponding severity (1-5) in symptomSeverities';
        },
      },
    });
  };
}

export class SubmitAssessmentDto {
  @IsEnum(TreatmentCategoryEnum)
  treatmentCategory!: string;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  selectedGoals!: string[];

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @EachSymptomHasSeverity()
  selectedSymptoms!: string[];

  @IsObject()
  @IsSymptomSeverities()
  symptomSeverities!: Record<string, number>;

  @IsOptional()
  @IsString()
  symptomDuration?: string;

  @IsOptional()
  @IsBoolean()
  hasPriorTreatment?: boolean;

  @IsOptional()
  @IsString()
  exerciseFrequency?: string;

  @IsOptional()
  @IsString()
  diet?: string;

  @IsOptional()
  @IsString()
  sleepHours?: string;

  @IsOptional()
  @IsString()
  stressLevel?: string;

  @IsOptional()
  @IsString()
  alcoholUse?: string;

  @IsOptional()
  @IsBoolean()
  willingLabWork?: boolean;

  @IsOptional()
  @IsBoolean()
  willingStructuredProgram?: boolean;

  @IsOptional()
  @IsString()
  appointmentPreference?: string;

  @IsOptional()
  @IsString()
  startTimeline?: string;

  @IsEnum(BudgetBandEnum)
  budgetBand!: string;

  @IsEnum(TelehealthPreferenceEnum)
  telehealthPreference!: string;

  @IsOptional()
  @IsString()
  biologicalSex?: string;

  @IsOptional()
  @IsBoolean()
  pregnantOrPlanning?: boolean;

  @IsOptional()
  @IsBoolean()
  takingPrescriptions?: boolean;

  @IsOptional()
  @IsBoolean()
  hadPriorTherapy?: boolean;

  @IsOptional()
  @IsBoolean()
  medicationAllergies?: boolean;

  @ValidateIf((o: SubmitAssessmentDto) => o.medicationAllergies === true)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  allergyDetails?: string;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  chronicConditions!: string[];

  /**
   * Free-text "other" chronic condition. There is no matching column on
   * patient_assessments yet (only the coded assessment_chronic_conditions
   * join table exists), so this is accepted so the request stops 400ing but
   * is not currently persisted. Persisting it needs a schema migration
   * (e.g. an other_chronic_condition column), which is out of scope here.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  otherChronicCondition?: string;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  currentPrescriptions!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  otherMedications?: string;

  @IsString()
  @Matches(/^\d{5}$/, { message: 'zipCode must be a 5-digit US postal code' })
  zipCode!: string;

  @IsBoolean()
  consentGiven!: boolean;

  @IsString()
  consentVersion!: string;
}

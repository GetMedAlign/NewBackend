import { Injectable, Inject } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { ENCRYPTION_PORT } from '../../auth/domain/ports/encryption.port';
import type { EncryptionPort } from '../../auth/domain/ports/encryption.port';
import type {
  AssessmentRepositoryPort,
  AssessmentCreateInput,
} from '../domain/ports/assessment-repository.port';
import type { Assessment } from '../domain/assessment.entity';

type DbAssessmentRow = {
  id: string;
  sessionId: string;
  patientId: string | null;
  treatmentCategory: string;
  symptomDuration: string | null;
  exerciseFrequency: string | null;
  diet: string | null;
  sleepHours: string | null;
  stressLevel: string | null;
  alcoholUse: string | null;
  appointmentPreference: string | null;
  biologicalSex: string | null;
  allergyDetails: string | null;
  otherMedications: string | null;
  hasPriorTreatment: boolean | null;
  willingLabWork: boolean | null;
  willingStructuredProgram: boolean | null;
  startTimeline: string | null;
  budgetBand: string;
  telehealthPreference: string;
  pregnantOrPlanning: boolean | null;
  takingPrescriptions: boolean | null;
  hadPriorTherapy: boolean | null;
  medicationAllergies: boolean | null;
  zipCode: string;
  consentGiven: boolean;
  consentVersion: string;
  consentGivenAt: Date;
  submittedAt: Date;
  goals: { goalCode: string }[];
  symptoms: { symptomCode: string; severity: number }[];
  chronicConditions: { conditionCode: string }[];
  prescriptions: { prescriptionCode: string }[];
};

@Injectable()
export class PrismaAssessmentRepository implements AssessmentRepositoryPort {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENCRYPTION_PORT) private readonly encryption: EncryptionPort,
  ) {}

  async create(
    data: AssessmentCreateInput,
    ctx: { userId?: string },
  ): Promise<{ id: string; sessionId: string }> {
    const sessionId = `session_${randomBytes(16).toString('hex')}`;
    const now = new Date();

    const encryptedFields = {
      symptomDuration: data.symptomDuration ? this.encryption.encrypt(data.symptomDuration) : null,
      exerciseFrequency: data.exerciseFrequency
        ? this.encryption.encrypt(data.exerciseFrequency)
        : null,
      diet: data.diet ? this.encryption.encrypt(data.diet) : null,
      sleepHours: data.sleepHours ? this.encryption.encrypt(data.sleepHours) : null,
      stressLevel: data.stressLevel ? this.encryption.encrypt(data.stressLevel) : null,
      alcoholUse: data.alcoholUse ? this.encryption.encrypt(data.alcoholUse) : null,
      appointmentPreference: data.appointmentPreference
        ? this.encryption.encrypt(data.appointmentPreference)
        : null,
      biologicalSex: data.biologicalSex ? this.encryption.encrypt(data.biologicalSex) : null,
      allergyDetails: data.allergyDetails ? this.encryption.encrypt(data.allergyDetails) : null,
      otherMedications: data.otherMedications
        ? this.encryption.encrypt(data.otherMedications)
        : null,
    };

    const encryptedConditions = data.chronicConditions.map((c) => ({
      conditionCode: this.encryption.encrypt(c),
    }));

    const encryptedPrescriptions = data.currentPrescriptions.map((p) => ({
      prescriptionCode: this.encryption.encrypt(p),
    }));

    if (!ctx.userId) {
      // Anonymous: asSystem, no patient link
      const assessment = await this.prisma.asSystem((client) =>
        client.patientAssessment.create({
          data: {
            sessionId,
            treatmentCategory: data.treatmentCategory as Parameters<
              typeof client.patientAssessment.create
            >[0]['data']['treatmentCategory'],
            ...encryptedFields,
            hasPriorTreatment: data.hasPriorTreatment ?? null,
            willingLabWork: data.willingLabWork ?? null,
            willingStructuredProgram: data.willingStructuredProgram ?? null,
            startTimeline: data.startTimeline ?? null,
            budgetBand: data.budgetBand,
            telehealthPreference: data.telehealthPreference,
            pregnantOrPlanning: data.pregnantOrPlanning ?? null,
            takingPrescriptions: data.takingPrescriptions ?? null,
            hadPriorTherapy: data.hadPriorTherapy ?? null,
            medicationAllergies: data.medicationAllergies ?? null,
            zipCode: data.zipCode,
            consentGiven: data.consentGiven,
            consentVersion: data.consentVersion,
            consentGivenAt: now,
            submittedAt: now,
            goals: {
              create: data.selectedGoals.map((g) => ({ goalCode: g })),
            },
            symptoms: {
              create: data.selectedSymptoms.map((s) => ({
                symptomCode: s,
                severity: data.symptomSeverities[s] as number,
              })),
            },
            chronicConditions: {
              create: encryptedConditions,
            },
            prescriptions: {
              create: encryptedPrescriptions,
            },
          },
          select: { id: true, sessionId: true },
        }),
      );
      return assessment;
    }

    // Authenticated: withUserContext, upsert patient, then insert assessment
    const userId = ctx.userId;
    return this.prisma.withUserContext({ userId, role: 'patient', ip: null }, async (tx) => {
      // Upsert the patient row
      const patient = await tx.patient.upsert({
        where: { userId },
        create: { userId, zipCode: data.zipCode },
        update: { lastAssessmentAt: now },
        select: { id: true },
      });

      const assessment = await tx.patientAssessment.create({
        data: {
          sessionId,
          patientId: patient.id,
          treatmentCategory: data.treatmentCategory as Parameters<
            typeof tx.patientAssessment.create
          >[0]['data']['treatmentCategory'],
          ...encryptedFields,
          hasPriorTreatment: data.hasPriorTreatment ?? null,
          willingLabWork: data.willingLabWork ?? null,
          willingStructuredProgram: data.willingStructuredProgram ?? null,
          startTimeline: data.startTimeline ?? null,
          budgetBand: data.budgetBand,
          telehealthPreference: data.telehealthPreference,
          pregnantOrPlanning: data.pregnantOrPlanning ?? null,
          takingPrescriptions: data.takingPrescriptions ?? null,
          hadPriorTherapy: data.hadPriorTherapy ?? null,
          medicationAllergies: data.medicationAllergies ?? null,
          zipCode: data.zipCode,
          consentGiven: data.consentGiven,
          consentVersion: data.consentVersion,
          consentGivenAt: now,
          submittedAt: now,
          goals: {
            create: data.selectedGoals.map((g) => ({ goalCode: g })),
          },
          symptoms: {
            create: data.selectedSymptoms.map((s) => ({
              symptomCode: s,
              severity: data.symptomSeverities[s] as number,
            })),
          },
          chronicConditions: {
            create: encryptedConditions,
          },
          prescriptions: {
            create: encryptedPrescriptions,
          },
        },
        select: { id: true, sessionId: true },
      });

      return assessment;
    });
  }

  async findBySessionId(sessionId: string): Promise<Assessment | null> {
    const row = await this.prisma.asSystem((client) =>
      client.patientAssessment.findUnique({
        where: { sessionId },
        include: {
          goals: true,
          symptoms: true,
          chronicConditions: true,
          prescriptions: true,
        },
      }),
    );

    if (!row) return null;
    return this.toEntity(row as DbAssessmentRow);
  }

  async findLatestByPatientUser(userId: string): Promise<Assessment | null> {
    const row = await this.prisma.withUserContext(
      { userId, role: 'patient', ip: null },
      async (tx) => {
        const patient = await tx.patient.findUnique({
          where: { userId },
          select: { id: true },
        });
        if (!patient) return null;

        return tx.patientAssessment.findFirst({
          where: { patientId: patient.id },
          orderBy: { submittedAt: 'desc' },
          include: {
            goals: true,
            symptoms: true,
            chronicConditions: true,
            prescriptions: true,
          },
        });
      },
    );

    if (!row) return null;
    return this.toEntity(row as DbAssessmentRow);
  }

  async linkToPatient(sessionId: string, userId: string): Promise<{ count: number }> {
    const now = new Date();
    return this.prisma.asSystem(async (client) => {
      // Upsert patient row (no changes to timestamps yet)
      const patient = await client.patient.upsert({
        where: { userId },
        create: { userId },
        update: {},
        select: { id: true },
      });

      const patientId = patient.id;

      // Atomic conditional claim: only update the row if it is still unclaimed.
      // If another concurrent request already claimed it, count will be 0.
      const [claimResult] = await client.$transaction([
        client.patientAssessment.updateMany({
          where: { sessionId, patientId: null },
          data: { patientId },
        }),
        client.patient.update({
          where: { id: patientId },
          data: { lastAssessmentAt: now },
        }),
      ]);

      return { count: claimResult.count };
    });
  }

  private toEntity(row: DbAssessmentRow): Assessment {
    const symptomSeverities: Record<string, number> = {};
    for (const s of row.symptoms) {
      symptomSeverities[s.symptomCode] = s.severity;
    }

    return {
      id: row.id,
      sessionId: row.sessionId,
      patientId: row.patientId,
      treatmentCategory: row.treatmentCategory,
      selectedGoals: row.goals.map((g) => g.goalCode),
      selectedSymptoms: row.symptoms.map((s) => s.symptomCode),
      symptomSeverities,
      symptomDuration: row.symptomDuration ? this.encryption.decrypt(row.symptomDuration) : null,
      hasPriorTreatment: row.hasPriorTreatment,
      exerciseFrequency: row.exerciseFrequency
        ? this.encryption.decrypt(row.exerciseFrequency)
        : null,
      diet: row.diet ? this.encryption.decrypt(row.diet) : null,
      sleepHours: row.sleepHours ? this.encryption.decrypt(row.sleepHours) : null,
      stressLevel: row.stressLevel ? this.encryption.decrypt(row.stressLevel) : null,
      alcoholUse: row.alcoholUse ? this.encryption.decrypt(row.alcoholUse) : null,
      willingLabWork: row.willingLabWork,
      willingStructuredProgram: row.willingStructuredProgram,
      appointmentPreference: row.appointmentPreference
        ? this.encryption.decrypt(row.appointmentPreference)
        : null,
      startTimeline: row.startTimeline,
      budgetBand: row.budgetBand,
      telehealthPreference: row.telehealthPreference,
      biologicalSex: row.biologicalSex ? this.encryption.decrypt(row.biologicalSex) : null,
      pregnantOrPlanning: row.pregnantOrPlanning,
      takingPrescriptions: row.takingPrescriptions,
      hadPriorTherapy: row.hadPriorTherapy,
      medicationAllergies: row.medicationAllergies,
      allergyDetails: row.allergyDetails ? this.encryption.decrypt(row.allergyDetails) : null,
      chronicConditions: row.chronicConditions.map((c) => this.encryption.decrypt(c.conditionCode)),
      currentPrescriptions: row.prescriptions.map((p) =>
        this.encryption.decrypt(p.prescriptionCode),
      ),
      otherMedications: row.otherMedications ? this.encryption.decrypt(row.otherMedications) : null,
      zipCode: row.zipCode,
      submittedAt: row.submittedAt,
    };
  }
}

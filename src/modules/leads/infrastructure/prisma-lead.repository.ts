import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';

import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { ENCRYPTION_PORT } from '../../auth/domain/ports/encryption.port';
import type { EncryptionPort } from '../../auth/domain/ports/encryption.port';
import type {
  LeadRepositoryPort,
  LeadCreateInput,
  LeadDeliveryStatus,
  PatientLeadView,
  WebhookDeliveryRecord,
} from '../domain/ports/lead-repository.port';

@Injectable()
export class PrismaLeadRepository implements LeadRepositoryPort {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENCRYPTION_PORT) private readonly encryption: EncryptionPort,
  ) {}

  async create(data: LeadCreateInput): Promise<{ leadId: string }> {
    const leadId = `lead_${randomBytes(16).toString('hex')}`;
    const patientPhone = data.patientPhone ? this.encryption.encrypt(data.patientPhone) : null;

    // Leads can be anonymous — run as system so the insert isn't RLS-blocked.
    const lead = await this.prisma.asSystem((client) =>
      client.lead.create({
        data: {
          leadId,
          clinicId: data.clinicId,
          assessmentId: data.assessmentId,
          patientId: data.patientId,
          patientFirstName: data.patientFirstName,
          patientEmail: data.patientEmail,
          patientZip: data.patientZip,
          treatmentCategory: data.treatmentCategory,
          topGoals: data.topGoals,
          topSymptoms: data.topSymptoms,
          budgetBand: data.budgetBand,
          telehealthPreference: data.telehealthPreference,
          appointmentPreference: data.appointmentPreference,
          startTimeline: data.startTimeline,
          patientPhone,
          leadSource: 'assessment',
          deliveryStatus: 'pending',
          clinicStatus: 'new',
          receivedAt: new Date(),
        },
        select: { leadId: true },
      }),
    );

    return lead;
  }

  async recordDelivery(leadId: string, record: WebhookDeliveryRecord): Promise<void> {
    await this.prisma.asSystem(async (client) => {
      const lead = await client.lead.findUnique({
        where: { leadId },
        select: { id: true },
      });
      if (!lead) return;
      await client.webhookDelivery.create({
        data: {
          leadId: lead.id,
          url: record.url,
          status: record.status,
          responseCode: record.responseCode ?? null,
          error: record.error ?? null,
          attemptedAt: new Date(),
        },
      });
    });
  }

  async setDeliveryStatus(
    leadId: string,
    status: LeadDeliveryStatus,
    deliveredAt?: Date,
  ): Promise<void> {
    await this.prisma.asSystem((client) =>
      client.lead.update({
        where: { leadId },
        data: { deliveryStatus: status, deliveredAt: deliveredAt ?? null },
      }),
    );
  }

  async findByPatientUser(userId: string): Promise<PatientLeadView[]> {
    return this.prisma.withUserContext({ userId, role: 'patient', ip: null }, async (tx) => {
      interface RawRow {
        leadId: string;
        clinicId: string;
        clinicName: string;
        clinicSlug: string;
        websiteUrl: string | null;
        submittedAt: Date;
        treatmentCategory: string;
        topGoals: string | null;
        topSymptoms: string | null;
        budgetBand: string | null;
        telehealthPreference: string | null;
        startTimeline: string | null;
        appointmentPreference: string | null;
        clinicCategory: string | null;
      }
      const rows = await tx.$queryRaw<RawRow[]>(
        Prisma.sql`
          SELECT
            l.lead_id              AS "leadId",
            l.clinic_id            AS "clinicId",
            c.name                 AS "clinicName",
            c.slug                 AS "clinicSlug",
            c.website_url          AS "websiteUrl",
            l.received_at          AS "submittedAt",
            l.treatment_category   AS "treatmentCategory",
            l.top_goals            AS "topGoals",
            l.top_symptoms         AS "topSymptoms",
            l.budget_band          AS "budgetBand",
            l.telehealth_preference AS "telehealthPreference",
            l.start_timeline       AS "startTimeline",
            l.appointment_preference AS "appointmentPreference",
            (
              SELECT cc.category::text
              FROM clinic_categories cc
              WHERE cc.clinic_id = l.clinic_id
              ORDER BY cc.category
              LIMIT 1
            ) AS "clinicCategory"
          FROM leads l
          JOIN clinics c ON c.id = l.clinic_id
          JOIN patients p ON p.id = l.patient_id
          WHERE p.user_id = ${userId}::uuid
          ORDER BY l.received_at DESC
        `,
      );
      return rows.map((r): PatientLeadView => ({
        leadId: r.leadId,
        clinicId: r.clinicId,
        clinicName: r.clinicName,
        clinicSlug: r.clinicSlug,
        clinicCategory: r.clinicCategory ?? 'hormone',
        websiteUrl: r.websiteUrl ?? null,
        submittedAt: r.submittedAt,
        treatmentCategory: r.treatmentCategory,
        topGoals: r.topGoals ? r.topGoals.split(',').filter(Boolean) : [],
        topSymptoms: r.topSymptoms ? r.topSymptoms.split(',').filter(Boolean) : [],
        budgetBand: r.budgetBand ?? null,
        telehealthPreference: r.telehealthPreference ?? null,
        startTimeline: r.startTimeline ?? null,
        appointmentPreference: r.appointmentPreference ?? null,
      }));
    });
  }
}

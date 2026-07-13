import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { ENCRYPTION_PORT } from '../../auth/domain/ports/encryption.port';
import type { EncryptionPort } from '../../auth/domain/ports/encryption.port';
import type {
  LeadRepositoryPort,
  LeadCreateInput,
  LeadDeliveryStatus,
  LeadView,
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

  async findByPatientUser(userId: string): Promise<LeadView[]> {
    return this.prisma.withUserContext({ userId, role: 'patient', ip: null }, async (tx) => {
      const rows = await tx.lead.findMany({
        orderBy: { receivedAt: 'desc' },
        select: {
          leadId: true,
          clinicId: true,
          treatmentCategory: true,
          clinicStatus: true,
          deliveryStatus: true,
          receivedAt: true,
        },
      });
      return rows.map((r): LeadView => ({
        leadId: r.leadId,
        clinicId: r.clinicId,
        treatmentCategory: r.treatmentCategory,
        clinicStatus: r.clinicStatus,
        deliveryStatus: r.deliveryStatus,
        receivedAt: r.receivedAt,
      }));
    });
  }
}

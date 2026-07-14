import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  ClinicLeadRepositoryPort,
  ClinicLeadView,
} from '../domain/ports/clinic-lead-repository.port';

type LeadRow = {
  id: string;
  leadId: string;
  receivedAt: Date;
  leadSource: string;
  patientFirstName: string;
  patientEmail: string;
  patientZip: string | null;
  treatmentCategory: string;
  topGoals: string | null;
  topSymptoms: string | null;
  budgetBand: string | null;
  telehealthPreference: string | null;
  startTimeline: string | null;
  deliveryStatus: string;
  clinicStatus: string;
  clinicId: string;
  clinicName: string;
  clinicWebsiteUrl: string | null;
};

function rowToView(row: LeadRow): ClinicLeadView {
  return {
    id: row.id,
    leadId: row.leadId,
    receivedAt: row.receivedAt,
    leadSource: row.leadSource,
    patientFirstName: row.patientFirstName,
    patientEmail: row.patientEmail,
    patientZip: row.patientZip,
    treatmentCategory: row.treatmentCategory,
    topGoals: row.topGoals,
    topSymptoms: row.topSymptoms,
    budgetBand: row.budgetBand,
    telehealthPreference: row.telehealthPreference,
    startTimeline: row.startTimeline,
    deliveryStatus: row.deliveryStatus,
    clinicStatus: row.clinicStatus,
    clinicId: row.clinicId,
    clinicName: row.clinicName,
    clinicWebsiteUrl: row.clinicWebsiteUrl,
  };
}

@Injectable()
export class PrismaClinicLeadRepository implements ClinicLeadRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async listByClinic(clinicId: string): Promise<ClinicLeadView[]> {
    return this.prisma.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId },
      async (tx) => {
        const rows = await tx.$queryRaw<LeadRow[]>`
          SELECT
            l.id,
            l.lead_id               AS "leadId",
            l.received_at           AS "receivedAt",
            l.lead_source           AS "leadSource",
            l.patient_first_name    AS "patientFirstName",
            l.patient_email         AS "patientEmail",
            l.patient_zip           AS "patientZip",
            l.treatment_category    AS "treatmentCategory",
            l.top_goals             AS "topGoals",
            l.top_symptoms          AS "topSymptoms",
            l.budget_band           AS "budgetBand",
            l.telehealth_preference AS "telehealthPreference",
            l.start_timeline        AS "startTimeline",
            l.delivery_status       AS "deliveryStatus",
            l.clinic_status         AS "clinicStatus",
            l.clinic_id             AS "clinicId",
            c.name                  AS "clinicName",
            c.website_url           AS "clinicWebsiteUrl"
          FROM leads l
          JOIN clinics c ON c.id = l.clinic_id
          WHERE l.clinic_id = ${clinicId}::uuid
          ORDER BY l.received_at DESC
        `;
        return rows.map(rowToView);
      },
    );
  }

  async findByClinic(clinicId: string, leadId: string): Promise<ClinicLeadView | null> {
    return this.prisma.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId },
      async (tx) => {
        const rows = await tx.$queryRaw<LeadRow[]>`
          SELECT
            l.id,
            l.lead_id               AS "leadId",
            l.received_at           AS "receivedAt",
            l.lead_source           AS "leadSource",
            l.patient_first_name    AS "patientFirstName",
            l.patient_email         AS "patientEmail",
            l.patient_zip           AS "patientZip",
            l.treatment_category    AS "treatmentCategory",
            l.top_goals             AS "topGoals",
            l.top_symptoms          AS "topSymptoms",
            l.budget_band           AS "budgetBand",
            l.telehealth_preference AS "telehealthPreference",
            l.start_timeline        AS "startTimeline",
            l.delivery_status       AS "deliveryStatus",
            l.clinic_status         AS "clinicStatus",
            l.clinic_id             AS "clinicId",
            c.name                  AS "clinicName",
            c.website_url           AS "clinicWebsiteUrl"
          FROM leads l
          JOIN clinics c ON c.id = l.clinic_id
          WHERE l.clinic_id = ${clinicId}::uuid
            AND l.lead_id = ${leadId}
        `;
        if (rows.length === 0) return null;
        return rowToView(rows[0]!);
      },
    );
  }

  async updateStatus(clinicId: string, leadId: string, status: string): Promise<boolean> {
    return this.prisma.withUserContext(
      { userId: null, role: 'clinic', ip: null, clinicId },
      async (tx) => {
        const result = await tx.$executeRaw`
          UPDATE leads
          SET clinic_status = ${status}
          WHERE lead_id = ${leadId}
            AND clinic_id = ${clinicId}::uuid
        `;
        return result > 0;
      },
    );
  }
}

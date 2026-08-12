import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  AppointmentRecord,
  AppointmentRepositoryPort,
  CreateAppointmentInput,
} from '../domain/ports/appointment-repository.port';

const withLead = {
  include: {
    lead: { select: { leadId: true } },
    clinic: { select: { name: true } },
  },
} satisfies Prisma.AppointmentDefaultArgs;
type AppointmentWithLead = Prisma.AppointmentGetPayload<typeof withLead>;

@Injectable()
export class PrismaAppointmentRepository implements AppointmentRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async createIfAbsent(input: CreateAppointmentInput): Promise<void> {
    // Upsert on the unique calendly_invitee_uri: a redelivery of the same
    // invitee.created event hits the (no-op) update branch instead of
    // failing on the unique constraint or duplicating the row. Runs via
    // asSystem, since appointments has no app-authenticated INSERT policy
    // (Task 1); only asSystem (the postgres role, which bypasses RLS) can
    // write here.
    await this.prisma.asSystem((client) =>
      client.appointment.upsert({
        where: { calendlyInviteeUri: input.calendlyInviteeUri },
        create: {
          clinic: { connect: { id: input.clinicId } },
          patientId: input.patientId ?? null,
          inviteeEmail: input.inviteeEmail,
          inviteeName: input.inviteeName,
          calendlyEventUri: input.calendlyEventUri,
          calendlyInviteeUri: input.calendlyInviteeUri,
          startTime: input.startTime,
          endTime: input.endTime,
          status: input.status,
          ...(input.leadId ? { lead: { connect: { leadId: input.leadId } } } : {}),
        },
        // Idempotent by design: a redelivered invitee.created is a no-op
        // (the row already exists), and a genuine reschedule arrives with a
        // brand-new calendly_invitee_uri (a fresh row), so this update
        // branch is never expected to change an existing row's data.
        update: {},
      }),
    );
  }

  async cancelByInviteeUri(clinicId: string, calendlyInviteeUri: string): Promise<string | null> {
    // Look up (not updateMany) so the update can be scoped to the exact row
    // this clinic owns, and its leadId returned in one round trip. Filtering
    // on BOTH calendly_invitee_uri and clinic_id means an appointment owned
    // by a different clinic is never matched, even if the invitee URI is
    // somehow known/guessed: a validly-signed webhook for clinic A can only
    // ever cancel clinic A's own appointments.
    return this.prisma.asSystem(async (client) => {
      const appointment = await client.appointment.findFirst({
        where: { calendlyInviteeUri, clinicId },
        select: { id: true, lead: { select: { leadId: true } } },
      });
      if (!appointment) return null;

      // Plain update (not updateMany): unknown/wrong-clinic URIs were
      // already ruled out above by the findFirst, and redelivering the same
      // cancellation just re-applies status = 'canceled', a no-op.
      await client.appointment.update({
        where: { id: appointment.id },
        data: { status: 'canceled' },
      });

      return appointment.lead?.leadId ?? null;
    });
  }

  async hasOtherBookedAppointment(
    clinicId: string,
    leadId: string,
    excludeInviteeUri: string,
  ): Promise<boolean> {
    const count = await this.prisma.asSystem((client) =>
      client.appointment.count({
        where: {
          clinicId,
          status: 'booked',
          calendlyInviteeUri: { not: excludeInviteeUri },
          lead: { leadId },
        },
      }),
    );
    return count > 0;
  }

  async listForClinic(clinicId: string): Promise<AppointmentRecord[]> {
    const rows = await this.prisma.asSystem((client) =>
      client.appointment.findMany({
        where: { clinicId },
        orderBy: { startTime: 'desc' },
        ...withLead,
      }),
    );
    return rows.map((row) => this.toRecord(row));
  }

  async listForPatient(params: { patientId: string; sessionId: string }): Promise<AppointmentRecord[]> {
    // Only add the sessionId clause when it's actually present: an empty
    // sessionId must never broaden the match to every anonymous
    // (sessionId: null-ish) appointment. patientId is always included when
    // present; if both are empty there is nothing to scope to, so skip the
    // query entirely.
    const conditions: Prisma.AppointmentWhereInput[] = [];
    if (params.patientId) conditions.push({ patientId: params.patientId });
    if (params.sessionId) conditions.push({ sessionId: params.sessionId });
    if (conditions.length === 0) return [];

    const rows = await this.prisma.asSystem((client) =>
      client.appointment.findMany({
        where: { OR: conditions },
        orderBy: { startTime: 'desc' },
        ...withLead,
      }),
    );
    return rows.map((row) => this.toRecord(row));
  }

  private toRecord(row: AppointmentWithLead): AppointmentRecord {
    return {
      id: row.id,
      clinicId: row.clinicId,
      clinicName: row.clinic.name,
      leadId: row.lead?.leadId ?? null,
      patientId: row.patientId,
      sessionId: row.sessionId,
      inviteeEmail: row.inviteeEmail,
      inviteeName: row.inviteeName,
      calendlyEventUri: row.calendlyEventUri,
      calendlyInviteeUri: row.calendlyInviteeUri,
      startTime: row.startTime,
      endTime: row.endTime,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

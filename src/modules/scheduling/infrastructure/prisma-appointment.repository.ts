import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  AppointmentRecord,
  AppointmentRepositoryPort,
  CreateAppointmentInput,
} from '../domain/ports/appointment-repository.port';

const withLead = {
  include: { lead: { select: { leadId: true } } },
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
        update: {},
      }),
    );
  }

  async cancelByInviteeUri(calendlyInviteeUri: string): Promise<void> {
    // updateMany (not update) so an unknown/already-processed invitee URI
    // no-ops instead of throwing P2025.
    await this.prisma.asSystem((client) =>
      client.appointment.updateMany({
        where: { calendlyInviteeUri },
        data: { status: 'canceled' },
      }),
    );
  }

  async findLeadIdByInviteeUri(calendlyInviteeUri: string): Promise<string | null> {
    const appointment = await this.prisma.asSystem((client) =>
      client.appointment.findUnique({
        where: { calendlyInviteeUri },
        select: { lead: { select: { leadId: true } } },
      }),
    );
    return appointment?.lead?.leadId ?? null;
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
    const rows = await this.prisma.asSystem((client) =>
      client.appointment.findMany({
        where: {
          OR: [{ patientId: params.patientId }, { sessionId: params.sessionId }],
        },
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

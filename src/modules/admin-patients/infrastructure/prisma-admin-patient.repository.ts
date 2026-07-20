import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { AdminCtx } from '../../../infrastructure/security/admin-ctx';
import {
  toAdminPatientDto,
  type AdminPatientDto,
  type AdminPatientRow,
} from '../domain/patient-dto.mapper';
import {
  DELETED_LOCK_UNTIL,
  type AdminPatientRepositoryPort,
  type PatientWriteResult,
  type UpdatePatientInput,
} from '../domain/ports/admin-patient-repository.port';

/**
 * Raw row shape from the §1.7 query, before `Number(...)` conversion of the
 * `bigint` COUNT(*) result. Only `treatment_category` (a plain enum column)
 * is ever selected from `patient_assessments` — no encrypted PHI column is
 * referenced anywhere in this file.
 */
type RawPatientRow = Omit<AdminPatientRow, 'match_count'> & { match_count: bigint };

@Injectable()
export class PrismaAdminPatientRepository implements AdminPatientRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async listPatients(ctx: AdminCtx): Promise<AdminPatientDto[]> {
    return this.prisma.withUserContext(
      { userId: ctx.userId, role: ctx.role, ip: ctx.ip },
      async (tx) => {
        const rows = await tx.$queryRaw<RawPatientRow[]>`
          SELECT p.id,
                 u.name,
                 u.email,
                 p.date_of_birth      AS "date_of_birth",
                 p.zip_code           AS "zip_code",
                 p.created_at         AS "created_at",
                 p.last_assessment_at AS "last_assessment_at",
                 p.is_deleted         AS "is_deleted",
                 p.deleted_at         AS "deleted_at",
                 (SELECT a.treatment_category
                    FROM patient_assessments a
                   WHERE a.patient_id = p.id
                   ORDER BY a.consent_given_at DESC
                   LIMIT 1)                       AS "treatment_category",
                 (SELECT COUNT(*) FROM leads l WHERE l.patient_id = p.id) AS "match_count"
            FROM patients p
            JOIN users u ON u.id = p.user_id
           ORDER BY p.created_at DESC`;

        return rows.map(toDto);
      },
    );
  }

  async getPatient(ctx: AdminCtx, patientId: string): Promise<AdminPatientDto | null> {
    return this.prisma.withUserContext(
      { userId: ctx.userId, role: ctx.role, ip: ctx.ip },
      async (tx) => {
        const rows = await tx.$queryRaw<RawPatientRow[]>`
          SELECT p.id,
                 u.name,
                 u.email,
                 p.date_of_birth      AS "date_of_birth",
                 p.zip_code           AS "zip_code",
                 p.created_at         AS "created_at",
                 p.last_assessment_at AS "last_assessment_at",
                 p.is_deleted         AS "is_deleted",
                 p.deleted_at         AS "deleted_at",
                 (SELECT a.treatment_category
                    FROM patient_assessments a
                   WHERE a.patient_id = p.id
                   ORDER BY a.consent_given_at DESC
                   LIMIT 1)                       AS "treatment_category",
                 (SELECT COUNT(*) FROM leads l WHERE l.patient_id = p.id) AS "match_count"
            FROM patients p
            JOIN users u ON u.id = p.user_id
           WHERE p.id = ${patientId}::uuid`;

        const row = rows[0];
        return row ? toDto(row) : null;
      },
    );
  }

  async updatePatient(
    ctx: AdminCtx,
    patientId: string,
    input: UpdatePatientInput,
  ): Promise<PatientWriteResult> {
    return this.prisma.withUserContext(
      { userId: ctx.userId, role: ctx.role, ip: ctx.ip },
      async (tx) => {
        const rows = await tx.$queryRaw<{ user_id: string; is_deleted: boolean }[]>`
          SELECT user_id, is_deleted FROM patients WHERE id = ${patientId}::uuid`;
        const patient = rows[0];
        if (!patient) return 'not_found';
        if (patient.is_deleted) return 'already_deleted';

        // `name` lives on `users`, not `patients` (spec §1.8).
        if (input.name !== undefined) {
          await tx.$executeRaw`
            UPDATE users SET name = ${input.name} WHERE id = ${patient.user_id}::uuid`;
        }

        const sets: Prisma.Sql[] = [];
        if (input.zipCode !== undefined) sets.push(Prisma.sql`zip_code = ${input.zipCode}`);
        if (input.dob !== undefined) sets.push(Prisma.sql`date_of_birth = ${input.dob}::date`);

        if (sets.length > 0) {
          await tx.$executeRaw`
            UPDATE patients SET ${Prisma.join(sets, ', ')} WHERE id = ${patientId}::uuid`;
        }

        return 'ok';
      },
    );
  }

  async softDeletePatient(ctx: AdminCtx, patientId: string): Promise<PatientWriteResult> {
    return this.prisma.withUserContext(
      { userId: ctx.userId, role: ctx.role, ip: ctx.ip },
      async (tx) => {
        const rows = await tx.$queryRaw<{ is_deleted: boolean }[]>`
          SELECT is_deleted FROM patients WHERE id = ${patientId}::uuid`;
        const patient = rows[0];
        if (!patient) return 'not_found';
        if (patient.is_deleted) return 'already_deleted';

        // Both writes happen inside the same withUserContext transaction
        // (spec §3.3): if the second statement fails, the whole transaction
        // rolls back and neither write is persisted.
        await tx.$executeRaw`
          UPDATE patients SET is_deleted = true, deleted_at = now() WHERE id = ${patientId}::uuid`;
        await tx.$executeRaw`
          UPDATE users SET locked_until = ${DELETED_LOCK_UNTIL}
           WHERE id = (SELECT user_id FROM patients WHERE id = ${patientId}::uuid)`;

        return 'ok';
      },
    );
  }
}

function toDto(row: RawPatientRow): AdminPatientDto {
  return toAdminPatientDto({ ...row, match_count: Number(row.match_count) });
}

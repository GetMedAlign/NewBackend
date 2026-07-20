import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { AdminCtx } from '../../../infrastructure/security/admin-ctx';
import {
  toAdminPatientDto,
  type AdminPatientDto,
  type AdminPatientRow,
} from '../domain/patient-dto.mapper';
import type { AdminPatientRepositoryPort } from '../domain/ports/admin-patient-repository.port';

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
}

function toDto(row: RawPatientRow): AdminPatientDto {
  return toAdminPatientDto({ ...row, match_count: Number(row.match_count) });
}

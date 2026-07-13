import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type {
  PatientRepositoryPort,
  PatientProfile,
} from '../domain/ports/patient-repository.port';
import { PatientNotFoundError } from '../domain/errors/patient-not-found.error';

interface UserRow {
  id: string;
  name: string | null;
  email: string;
}

interface PatientRow {
  date_of_birth: Date | null;
  zip_code: string | null;
  is_deleted: boolean;
}

@Injectable()
export class PrismaPatientRepository implements PatientRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findProfile(userId: string): Promise<PatientProfile | null> {
    // Read the user row via asSystem (auth-identity owns users table)
    const userRows = await this.prisma.asSystem(
      (client) =>
        client.$queryRaw<UserRow[]>`
          SELECT id, name, email
          FROM users
          WHERE id = ${userId}::uuid
          LIMIT 1
        `,
    );
    const user = userRows[0];
    if (!user) return null;

    // Read patient row via withUserContext (RLS enforces per-patient isolation)
    const patientRows = await this.prisma.withUserContext(
      { userId, role: 'patient', ip: null },
      (tx) =>
        tx.$queryRaw<PatientRow[]>`
          SELECT date_of_birth, zip_code, is_deleted
          FROM patients
          WHERE user_id = ${userId}::uuid
          LIMIT 1
        `,
    );
    const patient = patientRows[0] ?? null;

    return {
      name: user.name ?? null,
      email: user.email,
      dob: patient?.date_of_birth ?? null,
      zipCode: patient?.zip_code ?? null,
      isDeleted: patient?.is_deleted ?? false,
      hasPatient: patient !== null,
    };
  }

  async findPatientIdByUserId(userId: string): Promise<string | null> {
    // RLS-scoped read: under withUserContext the caller can only ever read
    // their own patient row, so this always resolves the authenticated user's
    // patient id (matching the .NET Patients.FirstOrDefault(p => p.UserId)).
    const rows = await this.prisma.withUserContext(
      { userId, role: 'patient', ip: null },
      (tx) =>
        tx.$queryRaw<{ id: string }[]>`
          SELECT id
          FROM patients
          WHERE user_id = ${userId}::uuid
            AND is_deleted = false
          LIMIT 1
        `,
    );
    return rows[0]?.id ?? null;
  }

  async updateProfile(userId: string, data: { name: string; dob?: string }): Promise<void> {
    // Update user name via withUserContext so RLS (users_self_update policy) is enforced
    // in addition to the explicit WHERE clause.  asSystem is reserved for auth-identity
    // reads (e.g. findProfile users read); business-data writes belong under user context.
    await this.prisma.withUserContext(
      { userId, role: 'patient', ip: null },
      (tx) =>
        tx.$executeRaw`
          UPDATE users
          SET name = ${data.name}
          WHERE id = ${userId}::uuid
        `,
    );

    // Update patient dob if provided and parseable, via withUserContext (RLS)
    if (data.dob !== undefined) {
      const parsed = new Date(data.dob);
      if (!isNaN(parsed.getTime())) {
        // Check for deleted patient first
        const patientRows = await this.prisma.withUserContext(
          { userId, role: 'patient', ip: null },
          (tx) =>
            tx.$queryRaw<{ is_deleted: boolean }[]>`
              SELECT is_deleted
              FROM patients
              WHERE user_id = ${userId}::uuid
              LIMIT 1
            `,
        );
        const patient = patientRows[0];
        if (patient?.is_deleted) {
          throw new PatientNotFoundError();
        }
        if (patient) {
          await this.prisma.withUserContext(
            { userId, role: 'patient', ip: null },
            (tx) =>
              tx.$executeRaw`
                UPDATE patients
                SET date_of_birth = ${parsed}::date
                WHERE user_id = ${userId}::uuid
              `,
          );
        }
      }
    }
  }
}

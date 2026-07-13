import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../src/infrastructure/prisma/prisma.module';
import { CryptoModule } from '../../src/infrastructure/crypto/crypto.module';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PrismaAssessmentRepository } from '../../src/modules/assessments/infrastructure/prisma-assessment.repository';
import type { AssessmentCreateInput } from '../../src/modules/assessments/domain/ports/assessment-repository.port';

/** Creates a minimal user row in the DB (role defaults to 'patient') and returns its UUID. */
async function createTestUser(prisma: PrismaService, email: string): Promise<string> {
  const rows = await prisma.asSystem(
    (client) =>
      client.$queryRaw<{ id: string }[]>`
        SELECT create_user(${email}::citext, 'test-hash') AS id
      `,
  );
  return rows[0]!.id;
}

const BASE_INPUT: AssessmentCreateInput = {
  treatmentCategory: 'hormone',
  selectedGoals: ['goal_energy', 'goal_sleep'],
  selectedSymptoms: ['fatigue', 'brain_fog'],
  symptomSeverities: { fatigue: 4, brain_fog: 2 },
  allergyDetails: 'penicillin allergy',
  chronicConditions: ['diabetes', 'hypertension'],
  currentPrescriptions: ['metformin'],
  budgetBand: '200_500',
  telehealthPreference: 'yes',
  zipCode: '90210',
  consentGiven: true,
  consentVersion: '1.0',
};

describe('PrismaAssessmentRepository (integration)', () => {
  let repo: PrismaAssessmentRepository;
  let prisma: PrismaService;
  const sessionIds: string[] = [];

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ envFilePath: 'test/.env.test' }),
        PrismaModule,
        CryptoModule,
      ],
      providers: [PrismaAssessmentRepository],
    }).compile();

    repo = module.get(PrismaAssessmentRepository);
    prisma = module.get(PrismaService);
  });

  afterAll(async () => {
    // Clean up test data
    for (const sid of sessionIds) {
      await prisma.asSystem((client) =>
        client.patientAssessment.deleteMany({ where: { sessionId: sid } }),
      );
    }
  });

  it('stores allergy_details as ciphertext (not plaintext)', async () => {
    const { sessionId } = await repo.create(BASE_INPUT, {});
    sessionIds.push(sessionId);

    // Query the raw DB value directly
    const rows = await prisma.asSystem(
      (client) =>
        client.$queryRaw<{ allergy_details: string | null }[]>`
          SELECT allergy_details
          FROM patient_assessments
          WHERE session_id = ${sessionId}
          LIMIT 1
        `,
    );

    expect(rows.length).toBe(1);
    const rawValue = rows[0]?.allergy_details;
    // Value should not be plaintext
    expect(rawValue).not.toBe('penicillin allergy');
    // Should look like ciphertext (non-empty string)
    expect(typeof rawValue).toBe('string');
    expect((rawValue as string).length).toBeGreaterThan(0);
  });

  it('findBySessionId decrypts PHI back to plaintext', async () => {
    const { sessionId } = await repo.create(BASE_INPUT, {});
    sessionIds.push(sessionId);

    const assessment = await repo.findBySessionId(sessionId);
    expect(assessment).not.toBeNull();
    expect(assessment!.allergyDetails).toBe('penicillin allergy');
  });

  it('persists child rows (goals, symptoms with severity)', async () => {
    const { sessionId } = await repo.create(BASE_INPUT, {});
    sessionIds.push(sessionId);

    const assessment = await repo.findBySessionId(sessionId);
    expect(assessment).not.toBeNull();

    // Check goals
    expect(assessment!.selectedGoals).toHaveLength(2);
    expect(assessment!.selectedGoals).toContain('goal_energy');
    expect(assessment!.selectedGoals).toContain('goal_sleep');

    // Check symptoms
    expect(assessment!.selectedSymptoms).toHaveLength(2);
    expect(assessment!.symptomSeverities['fatigue']).toBe(4);
    expect(assessment!.symptomSeverities['brain_fog']).toBe(2);
  });

  it('decrypts chronicConditions and currentPrescriptions', async () => {
    const { sessionId } = await repo.create(BASE_INPUT, {});
    sessionIds.push(sessionId);

    const assessment = await repo.findBySessionId(sessionId);
    expect(assessment).not.toBeNull();
    expect(assessment!.chronicConditions).toHaveLength(2);
    expect(assessment!.chronicConditions).toContain('diabetes');
    expect(assessment!.chronicConditions).toContain('hypertension');
    expect(assessment!.currentPrescriptions).toHaveLength(1);
    expect(assessment!.currentPrescriptions).toContain('metformin');
  });

  describe('linkToPatient — atomic guarded claim', () => {
    let userId1: string;
    let userId2: string;

    beforeAll(async () => {
      // Create real user rows so FK constraints are satisfied
      const suffix = Date.now();
      userId1 = await createTestUser(prisma, `claim-user-1-${suffix}@test.local`);
      userId2 = await createTestUser(prisma, `claim-user-2-${suffix}@test.local`);
    });

    afterAll(async () => {
      // Must delete patients before users due to FK constraint.
      await prisma.asSystem(
        (client) =>
          client.$executeRaw`
          DELETE FROM patients
          WHERE user_id IN (${userId1}::uuid, ${userId2}::uuid)
        `,
      );
      await prisma.asSystem(
        (client) =>
          client.$executeRaw`
          DELETE FROM users
          WHERE id IN (${userId1}::uuid, ${userId2}::uuid)
        `,
      );
    });

    it('first claim succeeds (count=1) and second claim is rejected (count=0)', async () => {
      const { sessionId } = await repo.create(BASE_INPUT, {});
      sessionIds.push(sessionId);

      // First claim
      const first = await repo.linkToPatient(sessionId, userId1);
      expect(first.count).toBe(1);

      // Verify the row is actually linked to userId1's patient
      const rows = await prisma.asSystem(
        (client) =>
          client.$queryRaw<{ patient_id: string | null }[]>`
            SELECT pa.patient_id::text AS patient_id
            FROM patient_assessments pa
            WHERE pa.session_id = ${sessionId}
            LIMIT 1
          `,
      );
      expect(rows.length).toBe(1);
      expect(rows[0]?.patient_id).not.toBeNull();

      const patient1Id = rows[0]?.patient_id as string;

      // Verify the patient_id belongs to userId1 (not userId2)
      const patientRows = await prisma.asSystem(
        (client) =>
          client.$queryRaw<{ user_id: string }[]>`
            SELECT user_id::text FROM patients WHERE id = ${patient1Id}::uuid LIMIT 1
          `,
      );
      expect(patientRows[0]?.user_id).toBe(userId1);

      // Second claim attempt (repeat or concurrent) — should be rejected
      const second = await repo.linkToPatient(sessionId, userId2);
      expect(second.count).toBe(0);

      // DB row is still linked to userId1's patient
      const rowsAfter = await prisma.asSystem(
        (client) =>
          client.$queryRaw<{ patient_id: string | null }[]>`
            SELECT pa.patient_id::text AS patient_id
            FROM patient_assessments pa
            WHERE pa.session_id = ${sessionId}
            LIMIT 1
          `,
      );
      expect(rowsAfter[0]?.patient_id).toBe(patient1Id);
    });

    it('two concurrent claims of the same session do not both succeed', async () => {
      const { sessionId } = await repo.create(BASE_INPUT, {});
      sessionIds.push(sessionId);

      // Race two concurrent claims
      const [r1, r2] = await Promise.all([
        repo.linkToPatient(sessionId, userId1),
        repo.linkToPatient(sessionId, userId2),
      ]);

      const totalClaimed = r1.count + r2.count;
      // Exactly one must win
      expect(totalClaimed).toBe(1);
    });
  });
});

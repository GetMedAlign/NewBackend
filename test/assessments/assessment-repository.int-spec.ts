import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../src/infrastructure/prisma/prisma.module';
import { CryptoModule } from '../../src/infrastructure/crypto/crypto.module';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PrismaAssessmentRepository } from '../../src/modules/assessments/infrastructure/prisma-assessment.repository';
import type { AssessmentCreateInput } from '../../src/modules/assessments/domain/ports/assessment-repository.port';

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
});

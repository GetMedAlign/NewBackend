/**
 * Integration tests for PrismaClinicPhotoRepository against a live Postgres.
 */
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PrismaClinicPhotoRepository } from '../../src/modules/clinic-media/infrastructure/prisma-clinic-photo.repository';
import { seedPatientJourney } from '../../prisma/seed/patient-journey.seed';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const adapter = new PrismaPg(pool);
const seedPrisma = new PrismaClient({ adapter });

let prismaService: PrismaService;
let repo: PrismaClinicPhotoRepository;
let clinicAId: string;
let clinicBId: string;

beforeAll(async () => {
  await seedPatientJourney(seedPrisma);

  const clinicA = await seedPrisma.clinic.findUniqueOrThrow({
    where: { slug: 'vitality-hormone-nyc' },
    select: { id: true },
  });
  clinicAId = clinicA.id;

  const clinicB = await seedPrisma.clinic.findUniqueOrThrow({
    where: { slug: 'apex-peptide-telehealth' },
    select: { id: true },
  });
  clinicBId = clinicB.id;

  prismaService = new PrismaService();
  await prismaService.onModuleInit();
  repo = new PrismaClinicPhotoRepository(prismaService);
});

afterAll(async () => {
  // Clean up clinic_photos inserted during tests
  await prismaService.asSystem((client) =>
    client.clinicPhoto.deleteMany({ where: { clinicId: clinicAId } }),
  );
  // Restore logo_url to null
  await prismaService.asSystem((client) =>
    client.clinic.update({ where: { id: clinicAId }, data: { logoUrl: null } }),
  );
  await seedPatientJourney(seedPrisma);
  await prismaService.onModuleDestroy();
  await seedPrisma.$disconnect();
  await pool.end();
});

describe('PrismaClinicPhotoRepository', () => {
  describe('replacePhotos', () => {
    it('deletes prior rows and sets photo_count', async () => {
      await repo.replacePhotos(clinicAId, [
        'https://storage.test/a.png',
        'https://storage.test/b.png',
      ]);
      const photos = await repo.listPhotoUrls(clinicAId);
      expect(photos).toHaveLength(2);

      // Replace with a single photo
      await repo.replacePhotos(clinicAId, ['https://storage.test/c.png']);
      const photos2 = await repo.listPhotoUrls(clinicAId);
      expect(photos2).toHaveLength(1);
      expect(photos2[0]).toBe('https://storage.test/c.png');
    });
  });

  describe('listPhotoUrls', () => {
    it('returns URLs ordered by display_order', async () => {
      await repo.replacePhotos(clinicAId, [
        'https://storage.test/first.png',
        'https://storage.test/second.png',
        'https://storage.test/third.png',
      ]);
      const urls = await repo.listPhotoUrls(clinicAId);
      expect(urls).toEqual([
        'https://storage.test/first.png',
        'https://storage.test/second.png',
        'https://storage.test/third.png',
      ]);
    });
  });

  describe('getLogoUrl / setLogoUrl', () => {
    it('round-trips: set then get returns same URL', async () => {
      await repo.setLogoUrl(clinicAId, 'https://storage.test/logo.png');
      const url = await repo.getLogoUrl(clinicAId);
      expect(url).toBe('https://storage.test/logo.png');
    });
  });

  describe('RLS cross-context isolation', () => {
    it('clinic B context cannot read clinic A clinic_photos rows', async () => {
      // Insert photos for clinic A
      await repo.replacePhotos(clinicAId, ['https://storage.test/rls-probe.png']);

      // Directly query using clinicB context, targeting clinicA's rows
      const rows = await prismaService.withUserContext(
        { userId: null, role: 'clinic', ip: null, clinicId: clinicBId },
        (tx) =>
          tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM clinic_photos WHERE clinic_id = ${clinicAId}::uuid
          `,
      );

      // RLS should block cross-context reads
      expect(rows).toHaveLength(0);
    });
  });
});
